import crypto from "node:crypto";
import fs from "node:fs";
import { all, db, one } from "./db.js";

/**
 * What a campaign import left in a room, so the next one can act on it.
 *
 * Without this, importing a corrected bundle is a choice between two bad
 * answers: skip everything, and the corrections never arrive; or replace
 * everything, and every note the GM has written since is gone. Neither is what
 * "chapter 2" means.
 *
 * The ledger records what each bundle path became and a digest of what was
 * written. A later import then has three cases where a name comparison had one:
 *
 * - the bundle has not changed since last time — nothing to do;
 * - the bundle has changed and the room has not touched it — update it;
 * - the room has changed it since — a real conflict, and the only one worth
 *   asking a GM about.
 *
 * Two digests, because the ledger answers two questions and one number cannot.
 *
 * **source** is what the bundle carried — the file's bytes, the NPC's fields —
 * and comparing it to the incoming bundle says whether the campaign has changed.
 * **state** is the row as this importer left it, and comparing it to the row now
 * says whether the room has been at it since.
 *
 * Both are of what this importer wrote, never of the whole row. A column some
 * other feature owns must not make an entry look edited.
 */

export interface LedgerEntry {
  rowId: number;
  /** What the bundle carried, last time. */
  source: string;
  /** The row as this importer left it, last time. */
  state: string;
}

/** How an incoming thing stands against what the last import of this campaign left. */
export type LedgerVerdict =
  | { state: "fresh" }
  | { state: "unchanged"; rowId: number }
  | { state: "updatable"; rowId: number }
  | { state: "edited"; rowId: number };

export function digestOf(...parts: (string | number | null | undefined)[]) {
  return crypto
    .createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("\u0000"))
    .digest("hex");
}

/** A file's contents, for the one kind whose identity is its bytes. */
export function digestOfFile(file: string) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

interface EntryRow {
  kind: string;
  path: string;
  row_id: number;
  source_digest: string;
  state_digest: string;
}

export class CampaignLedger {
  private readonly previous = new Map<string, LedgerEntry>();
  private readonly written = new Map<
    string,
    { kind: string; path: string; rowId: number; source: string; state: string }
  >();
  private importId?: number;

  /**
   * Reads what the last import of this campaign into this room left behind.
   * A campaign never imported here has an empty ledger and every path is fresh,
   * which is exactly the behaviour that existed before this table did.
   */
  constructor(
    private readonly roomId: number,
    private readonly campaignId: string
  ) {
    const row = one<{ id: number }>(
      "SELECT id FROM room_imports WHERE room_id = ? AND campaign_id = ?",
      roomId,
      campaignId
    );
    if (!row) return;
    this.importId = row.id;
    for (const entry of all<EntryRow>(
      "SELECT kind, path, row_id, source_digest, state_digest FROM room_import_entries WHERE import_id = ?",
      row.id
    ))
      this.previous.set(`${entry.kind}\u0000${entry.path}`, {
        rowId: entry.row_id,
        source: entry.source_digest,
        state: entry.state_digest
      });
  }

  /** Whether this room has ever taken this campaign before. */
  get seen() {
    return this.importId !== undefined;
  }

  /**
   * Where an incoming thing stands.
   *
   * `held` gives the row's state **now**, or undefined when the row is gone —
   * which puts the path back to fresh rather than pointing the ledger at nothing
   * a GM deleted on purpose.
   *
   * The room's own edits are checked first. A thing the GM has changed since it
   * arrived is a conflict whether or not the campaign also changed it, and the
   * import has no business deciding that on its own.
   */
  verdict(kind: string, path: string, source: string, held: (rowId: number) => string | undefined): LedgerVerdict {
    const entry = this.previous.get(`${kind}\u0000${path}`);
    if (!entry) return { state: "fresh" };
    const current = held(entry.rowId);
    if (current === undefined) return { state: "fresh" };
    if (current !== entry.state) return { state: "edited", rowId: entry.rowId };
    return source === entry.source
      ? { state: "unchanged", rowId: entry.rowId }
      : { state: "updatable", rowId: entry.rowId };
  }

  record(kind: string, path: string, rowId: number, source: string, state: string) {
    this.written.set(`${kind}\u0000${path}`, { kind, path, rowId, source, state });
  }

  /**
   * Carries the previous entry forward exactly as it was.
   *
   * For a row the room has edited since it arrived, which this import is
   * therefore leaving alone. The entry has to be written — `commit` replaces
   * every entry, so a path left out is a path forgotten, and a forgotten
   * hireling is a second one on the next import — but it must not be written
   * with anything new. Recording what the bundle carried would make the row
   * read as up to date and let the next version overwrite an edit the GM made;
   * recording the row as it stands now would forget that they ever diverged.
   * Keeping both halves is what makes "yours stays yours" survive a re-import.
   */
  keep(kind: string, path: string) {
    const entry = this.previous.get(`${kind}\u0000${path}`);
    if (entry) this.written.set(`${kind}\u0000${path}`, { kind, path, ...entry });
  }

  /**
   * Writes the ledger for this import, replacing the previous one.
   *
   * Entries are replaced wholesale rather than merged: a path the new bundle no
   * longer carries is a path this campaign no longer owns, and keeping a stale
   * pointer would mean a later import claiming a row the GM has since made their
   * own. Called inside the import's transaction, so it lands or it does not.
   */
  commit(details: { name: string; version: string; manifest: unknown; accountId: number }) {
    if (!this.written.size && this.importId === undefined) return;

    if (this.importId === undefined) {
      this.importId = Number(
        db
          .prepare(
            `INSERT INTO room_imports (room_id, campaign_id, name, version, manifest_json, imported_by)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(
            this.roomId,
            this.campaignId,
            details.name,
            details.version,
            JSON.stringify(details.manifest),
            details.accountId
          ).lastInsertRowid
      );
    } else {
      db.prepare(
        `UPDATE room_imports SET name = ?, version = ?, manifest_json = ?, imported_by = ?, imported_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(details.name, details.version, JSON.stringify(details.manifest), details.accountId, this.importId);
      db.prepare("DELETE FROM room_import_entries WHERE import_id = ?").run(this.importId);
    }

    const insert = db.prepare(
      `INSERT INTO room_import_entries (import_id, kind, path, row_id, source_digest, state_digest)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const entry of this.written.values())
      insert.run(this.importId, entry.kind, entry.path, entry.rowId, entry.source, entry.state);
  }
}

export interface PreviousImport {
  campaignId: string;
  name: string;
  version: string;
  importedAt: string;
}

/** What this room last took from this campaign, for the preview to say so. */
export function previousImport(roomId: number, campaignId: string): PreviousImport | undefined {
  const row = one<{ campaign_id: string; name: string; version: string; imported_at: string }>(
    "SELECT campaign_id, name, version, imported_at FROM room_imports WHERE room_id = ? AND campaign_id = ?",
    roomId,
    campaignId
  );
  return row && { campaignId: row.campaign_id, name: row.name, version: row.version, importedAt: row.imported_at };
}
