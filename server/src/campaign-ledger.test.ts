import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { applyCampaign, type ApplyOptions } from "./campaign-apply.js";
import { previousImport } from "./campaign-ledger.js";
import { stageCampaignArchive } from "./campaign-staging.js";
import { config } from "./config.js";
import { all, db, one } from "./db.js";
import { installToybox } from "./test-fixture.js";

installToybox();

let roomId = 0;
const ACCOUNT = 1;

beforeEach(() => {
  db.exec(
    `DELETE FROM room_import_entries; DELETE FROM room_imports; DELETE FROM room_playlist_tracks;
     DELETE FROM room_playlists; DELETE FROM group_hirelings; DELETE FROM custom_npcs; DELETE FROM media;
     DELETE FROM memberships; DELETE FROM rooms; DELETE FROM accounts;`
  );
  db.prepare(
    "INSERT INTO accounts (id, username, password_hash, is_admin, account_role) VALUES (?, ?, '', 1, 'admin')"
  ).run(ACCOUNT, "Admin");
  roomId = Number(
    db
      .prepare("INSERT INTO rooms (name, system, theme, created_by) VALUES ('The Tomb', 'toybox', 'grim', ?)")
      .run(ACCOUNT).lastInsertRowid
  );
});

const png = (fill: number) => {
  const body = Buffer.alloc(64, fill);
  Buffer.from("89504e470d0a1a0a", "hex").copy(body);
  return new Uint8Array(body);
};
const bytes = (value: unknown) =>
  value instanceof Uint8Array ? value : new Uint8Array(Buffer.from(JSON.stringify(value)));

const manifest = (campaignId = "tomb", version = "1.0") => ({
  app: "devils-toys-campaign",
  bundleVersion: 1,
  campaignId,
  name: "Tomb of the Serpent Kings",
  version,
  system: "toybox"
});

/** Imports a bundle, as the same campaign unless told otherwise. */
function importBundle(files: Record<string, unknown>, options: Partial<ApplyOptions> = {}) {
  const archive = path.join(config.dataDir, `${Math.random().toString(36).slice(2)}.zip`);
  fs.writeFileSync(
    archive,
    zipSync(
      Object.fromEntries(
        Object.entries({ "manifest.json": manifest(), ...files }).map(([name, body]) => [name, bytes(body)])
      ),
      { level: 6 }
    )
  );
  const staged = stageCampaignArchive(archive, { roomId, accountId: ACCOUNT, archiveName: "tomb.devilcampaign.zip" });
  return applyCampaign(staged.directory, staged.campaign, roomId, ACCOUNT, {
    policy: "skip",
    takeRoomSettings: false,
    ...options
  });
}

const mediaRow = () =>
  one<{ id: number; stored_name: string; display_name: string }>(
    "SELECT id, stored_name, display_name FROM media WHERE room_id = ?",
    roomId
  )!;

describe("importing the same campaign a second time", () => {
  it("does nothing at all when the bundle has not changed", () => {
    const bundle = { "maps/keep.png": png(1), "npcs/vane.json": { name: "Vane", notes: "First." } };
    importBundle(bundle);
    const before = mediaRow();

    const again = importBundle(bundle);

    expect(again.media).toEqual({ added: 0, replaced: 0, skipped: 0, unchanged: 1 });
    expect(again.npcs).toEqual({ added: 0, replaced: 0, skipped: 0, unchanged: 1 });
    expect(again.bytes).toBe(0);
    // The same row, and the same file: nothing was written and nothing moved.
    expect(mediaRow()).toEqual(before);
    expect(all("SELECT id FROM media WHERE room_id = ?", roomId)).toHaveLength(1);
  });

  /**
   * What the ledger is for. The bundle has been corrected and the room has not
   * touched what it corrected, so the correction lands — even under "skip", which
   * governs collisions with things this campaign did not make.
   */
  it("updates what it made when the campaign has changed and the room has not", () => {
    importBundle({ "maps/keep.png": png(1), "npcs/vane.json": { name: "Vane", notes: "First." } });
    const before = mediaRow();

    const again = importBundle({ "maps/keep.png": png(2), "npcs/vane.json": { name: "Vane", notes: "Corrected." } });

    expect(again.media).toEqual({ added: 0, replaced: 1, skipped: 0, unchanged: 0 });
    expect(again.npcs).toEqual({ added: 0, replaced: 1, skipped: 0, unchanged: 0 });
    // The same row, so anything pointing at it still does.
    expect(mediaRow().id).toBe(before.id);
    expect(mediaRow().stored_name).not.toBe(before.stored_name);
    expect(one<{ notes: string }>("SELECT notes FROM custom_npcs WHERE room_id = ?", roomId)!.notes).toBe("Corrected.");
  });

  /**
   * The other half of the promise: what the GM has made their own since the
   * import is theirs. A corrected bundle must not quietly take back an NPC whose
   * notes now say what happened at the table.
   */
  it("leaves alone what the room has changed since it arrived", () => {
    importBundle({ "npcs/vane.json": { name: "Vane", notes: "First." } });
    db.prepare("UPDATE custom_npcs SET notes = 'She died in session four.' WHERE room_id = ?").run(roomId);

    const again = importBundle({ "npcs/vane.json": { name: "Vane", notes: "Corrected." } });

    expect(again.npcs).toEqual({ added: 0, replaced: 0, skipped: 1, unchanged: 0 });
    expect(one<{ notes: string }>("SELECT notes FROM custom_npcs WHERE room_id = ?", roomId)!.notes).toBe(
      "She died in session four."
    );
  });

  it("takes the GM's word for it when they ask for replace", () => {
    importBundle({ "npcs/vane.json": { name: "Vane", notes: "First." } });
    db.prepare("UPDATE custom_npcs SET notes = 'Mine now.' WHERE room_id = ?").run(roomId);

    const again = importBundle({ "npcs/vane.json": { name: "Vane", notes: "Corrected." } }, { policy: "replace" });

    expect(again.npcs.replaced).toBe(1);
    expect(one<{ notes: string }>("SELECT notes FROM custom_npcs WHERE room_id = ?", roomId)!.notes).toBe("Corrected.");
  });

  /**
   * The kinds with no identity of their own. Before the ledger, a second import
   * laid down a second Brann and a third laid down a third.
   */
  it("does not lay down a second hireling, a second ship, or a second debt", () => {
    const party = {
      "hirelings/brann.json": { name: "Brann", sheet: { trade: "Torchbearer" } },
      "obligations/debt.json": { name: "The Baron's loan", owedTo: "The Baron", amount: "500gp" }
    };
    importBundle(party);
    importBundle(party);
    importBundle(party);

    expect(all("SELECT id FROM group_hirelings WHERE room_id = ?", roomId)).toHaveLength(1);
    expect(all("SELECT id FROM group_obligations WHERE room_id = ?", roomId)).toHaveLength(1);
  });

  it("corrects a hireling the campaign changed, and keeps one the room renamed", () => {
    importBundle({
      "hirelings/brann.json": { name: "Brann", sheet: {} },
      "hirelings/edda.json": { name: "Edda", sheet: {} }
    });
    db.prepare("UPDATE group_hirelings SET name = 'Edda the Bold' WHERE name = 'Edda'").run();

    importBundle({
      "hirelings/brann.json": { name: "Brann the Brave", sheet: {} },
      "hirelings/edda.json": { name: "Edda", sheet: { trade: "Scout" } }
    });

    const names = all<{ name: string }>("SELECT name FROM group_hirelings WHERE room_id = ? ORDER BY id", roomId).map(
      (row) => row.name
    );
    expect(names).toEqual(["Brann the Brave", "Edda the Bold"]);
  });

  /**
   * A row the GM deleted is a decision, not an accident. The path goes back to
   * fresh rather than the ledger pointing at a row that is not there.
   */
  it("brings back something the room deleted, as a new thing", () => {
    importBundle({ "npcs/vane.json": { name: "Vane" } });
    db.prepare("DELETE FROM custom_npcs WHERE room_id = ?").run(roomId);

    const again = importBundle({ "npcs/vane.json": { name: "Vane" } });
    expect(again.npcs).toEqual({ added: 1, replaced: 0, skipped: 0, unchanged: 0 });
  });

  it("treats a different campaign as a different thing entirely", () => {
    importBundle({ "npcs/vane.json": { name: "Vane", notes: "First." } });

    // Same NPC name, another campaign: the name comparison decides, not the ledger.
    const archive = path.join(config.dataDir, "other.zip");
    fs.writeFileSync(
      archive,
      zipSync(
        {
          "manifest.json": bytes({ ...manifest("another-campaign"), name: "Another Campaign" }),
          "npcs/vane.json": bytes({ name: "Vane", notes: "Theirs." })
        },
        { level: 6 }
      )
    );
    const staged = stageCampaignArchive(archive, { roomId, accountId: ACCOUNT, archiveName: "other.zip" });
    const result = applyCampaign(staged.directory, staged.campaign, roomId, ACCOUNT, {
      policy: "skip",
      takeRoomSettings: false
    });

    expect(result.npcs).toEqual({ added: 0, replaced: 0, skipped: 1, unchanged: 0 });
  });
});

describe("what the ledger records", () => {
  it("keeps one row per campaign per room, and moves its version on", () => {
    importBundle({ "npcs/vane.json": { name: "Vane" } });
    expect(previousImport(roomId, "tomb")).toMatchObject({ campaignId: "tomb", name: "Tomb of the Serpent Kings" });

    importBundle({ "npcs/vane.json": { name: "Vane" } });
    expect(all("SELECT id FROM room_imports WHERE room_id = ?", roomId)).toHaveLength(1);
  });

  /**
   * A path the new bundle no longer carries is a path this campaign no longer
   * owns. Keeping a stale pointer would mean a later import claiming a row the GM
   * has since made their own.
   */
  it("forgets a path the campaign has stopped carrying", () => {
    importBundle({ "npcs/vane.json": { name: "Vane" }, "npcs/priest.json": { name: "Priest" } });
    expect(all("SELECT path FROM room_import_entries")).toHaveLength(2);

    importBundle({ "npcs/vane.json": { name: "Vane" } });
    const paths = all<{ path: string }>("SELECT path FROM room_import_entries").map((row) => row.path);
    expect(paths).toEqual(["npcs/vane.json"]);
    // The priest is still in the room; the campaign has simply stopped claiming it.
    expect(all("SELECT id FROM custom_npcs WHERE room_id = ?", roomId)).toHaveLength(2);
  });

  it("says nothing about a campaign this room has never taken", () => {
    expect(previousImport(roomId, "tomb")).toBeUndefined();
  });
});

describe("what belongs to the room stays the room's", () => {
  /**
   * The ledger's whole promise, across more than one re-import. An edited row
   * keeps its original entry rather than being re-recorded, so it goes on
   * reading as edited — a version that records what the bundle carried would
   * make the row look up to date and let the next import take the edit back.
   */
  it("keeps a hireling the room renamed, however many times the campaign returns", () => {
    importBundle({ "hirelings/brann.json": { name: "Brann", sheet: {} } });
    db.prepare("UPDATE group_hirelings SET name = 'Brann the Brave' WHERE room_id = ?").run(roomId);

    const named = () =>
      all<{ name: string }>("SELECT name FROM group_hirelings WHERE room_id = ?", roomId).map((row) => row.name);

    // The same bundle again, then a corrected one, then the corrected one twice.
    expect(importBundle({ "hirelings/brann.json": { name: "Brann", sheet: {} } }).group.skipped).toBe(1);
    expect(named()).toEqual(["Brann the Brave"]);

    expect(importBundle({ "hirelings/brann.json": { name: "Brann", sheet: { trade: "Scout" } } }).group.skipped).toBe(
      1
    );
    expect(importBundle({ "hirelings/brann.json": { name: "Brann", sheet: { trade: "Scout" } } }).group.skipped).toBe(
      1
    );
    expect(named()).toEqual(["Brann the Brave"]);
    // And still one of them: the path is remembered rather than forgotten.
    expect(all("SELECT id FROM group_hirelings WHERE room_id = ?", roomId)).toHaveLength(1);
  });

  it("keeps an obligation the room rewrote", () => {
    importBundle({ "obligations/debt.json": { name: "A debt", owedTo: "The Baron", amount: "500gp" } });
    db.prepare("UPDATE group_obligations SET amount = '50gp, and he knows it' WHERE room_id = ?").run(roomId);

    importBundle({ "obligations/debt.json": { name: "A debt", owedTo: "The Baron", amount: "900gp" } });
    importBundle({ "obligations/debt.json": { name: "A debt", owedTo: "The Baron", amount: "900gp" } });

    expect(one<{ amount: string }>("SELECT amount FROM group_obligations WHERE room_id = ?", roomId)!.amount).toBe(
      "50gp, and he knows it"
    );
    expect(all("SELECT id FROM group_obligations WHERE room_id = ?", roomId)).toHaveLength(1);
  });
});
