import crypto from "node:crypto";
import path from "node:path";
import express from "express";
import multer from "multer";
import { z } from "zod";
import {
  CREATION_NAME_KEY,
  creationEntryFrom,
  creationStepEntryField,
  type CharacterCreationDefinition,
  type CharacterEntry,
  type CreationDraft,
  type CreationStep,
  type CreationStepRecord,
  type CreationWrite,
  type SystemId
} from "@devils-toys/shared";
import type { AuthedRequest } from "./auth.js";
import { requireAuth, roomRole } from "./auth.js";
import { config } from "./config.js";
import { storedUploadBytes } from "./upload-usage.js";
import { characterItemsFor } from "./character-items.js";
import { all, db, one } from "./db.js";
import { inGameDisplayName } from "./display-name.js";
import {
  portraitImageTypes,
  PORTRAIT_UPLOAD_LIMIT_BYTES,
  removeStoredPortrait,
  removeUploadedPortrait,
  validPortraitFile
} from "./portrait-files.js";
import { broadcastRoom, refreshRoomPresence } from "./realtime.js";
import { characterWarningsFor, systemOrThrow } from "./systems.js";
import { characterVicesFor } from "./character-vices.js";
import {
  applyCreationWrite,
  availableCreationSteps,
  creationTotals,
  matchCatalogueItem,
  performCreationStep,
  readCreationDraft,
  refuseScoreAssignment,
  resolveCreationDefinition,
  revertCreationWrite,
  scoreAssignment
} from "./character-creation.js";

export const characterRouter = express.Router();

export interface CharacterRow {
  id: number;
  system: SystemId;
  owner_account_id: number | null;
  owner_username: string | null;
  pool_room_id: number | null;
  name: string;
  sheet_json: string;
  portrait_filename: string | null;
  portrait_stored_name: string | null;
  portrait_mime_type: string | null;
  portrait_size: number | null;
  /** The creation draft, or NULL for a character that was never built or has finished being built. */
  creation_json: string | null;
  updated_at: string;
}

const sheetSchema = z.record(z.unknown()).refine((value) => JSON.stringify(value).length <= 250_000, {
  message: "Character data is too large."
});

const uploadsDir = path.join(config.dataDir, "uploads");
const portraitUpload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename(_req, file, callback) {
      callback(null, `${crypto.randomUUID()}${portraitImageTypes.get(file.mimetype) ?? ""}`);
    }
  }),
  limits: { fileSize: PORTRAIT_UPLOAD_LIMIT_BYTES, files: 1 },
  fileFilter(_req, file, callback) {
    if (portraitImageTypes.has(file.mimetype)) callback(null, true);
    else callback(new Error("Only PNG, JPEG, and WebP portraits are supported."));
  }
});

function roomContext(accountId: number, roomId: number) {
  const role = roomRole(accountId, roomId);
  if (!role) return;
  const room = one<{ system: SystemId }>("SELECT system FROM rooms WHERE id = ?", roomId);
  return room && { role, system: room.system };
}

function parseSheet(json: string) {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function publicCharacter(row: CharacterRow, roomId: number) {
  const sheet = parseSheet(row.sheet_json);
  const activeBy = all<{ account_id: number; username: string }>(
    `SELECT m.account_id, a.username FROM memberships m
       JOIN accounts a ON a.id = m.account_id
       WHERE m.room_id = ? AND m.active_character_id = ? ORDER BY a.username`,
    roomId,
    row.id
  ).map((item) => ({
    accountId: item.account_id,
    username: item.username,
    displayName: inGameDisplayName(item.username, row.name)
  }));
  return {
    id: row.id,
    system: row.system,
    ownerAccountId: row.owner_account_id,
    ownerUsername: row.owner_username,
    poolRoomId: row.pool_room_id,
    name: row.name,
    sheet,
    portraitUrl: row.portrait_stored_name
      ? `/api/rooms/${roomId}/characters/${row.id}/portrait?v=${encodeURIComponent(row.portrait_stored_name)}`
      : null,
    portraitFilename: row.portrait_filename,
    warnings: characterWarningsFor(row.system, sheet),
    // What the builder has done so far, so a half-built character resumes where
    // it was left rather than starting again on a new phone. A draft naming
    // steps the system no longer declares comes back as a plain sheet.
    creation: readCreationDraft(row.system, row.creation_json) ?? null,
    activeBy,
    updatedAt: row.updated_at
  };
}

export function findVisibleCharacter(accountId: number, roomId: number, characterId: number) {
  const context = roomContext(accountId, roomId);
  if (!context) return;
  const row = one<CharacterRow>(
    `SELECT c.*, a.username AS owner_username FROM characters c
       LEFT JOIN accounts a ON a.id = c.owner_account_id
       WHERE c.id = ? AND c.system = ?`,
    characterId,
    context.system
  );
  if (!row) return;
  if (context.role === "player") {
    const activeInRoom = Boolean(
      one("SELECT 1 FROM memberships WHERE room_id = ? AND active_character_id = ?", roomId, row.id)
    );
    const visible =
      row.owner_account_id === accountId ||
      (row.owner_account_id === null && row.pool_room_id === roomId) ||
      activeInRoom;
    return visible ? { context, row } : undefined;
  }
  const ownerInRoom =
    row.owner_account_id !== null &&
    Boolean(one("SELECT 1 FROM memberships WHERE room_id = ? AND account_id = ?", roomId, row.owner_account_id));
  return row.pool_room_id === roomId || ownerInRoom ? { context, row } : undefined;
}

export function findAccessibleCharacter(accountId: number, roomId: number, characterId: number) {
  const visible = findVisibleCharacter(accountId, roomId, characterId);
  if (!visible) return;
  if (visible.context.role === "player" && visible.row.owner_account_id !== accountId) return;
  return visible;
}

export function broadcastCharacterChange(row: Pick<CharacterRow, "system" | "owner_account_id" | "pool_room_id">) {
  const roomIds = new Set<number>();
  if (row.pool_room_id) roomIds.add(row.pool_room_id);
  if (row.owner_account_id) {
    for (const item of all<{ room_id: number }>(
      `SELECT m.room_id FROM memberships m JOIN rooms r ON r.id = m.room_id
         WHERE m.account_id = ? AND r.system = ?`,
      row.owner_account_id,
      row.system
    ))
      roomIds.add(item.room_id);
  }
  for (const roomId of roomIds) {
    broadcastRoom(roomId, { type: "characters-updated" });
    refreshRoomPresence(roomId);
  }
}

characterRouter.get("/rooms/:roomId/characters", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const context = roomContext(req.account!.id, roomId);
  if (!context) return res.status(404).json({ error: "Room not found." });
  const select = `SELECT c.*, a.username AS owner_username FROM characters c
    LEFT JOIN accounts a ON a.id = c.owner_account_id`;
  const rows =
    context.role === "gm"
      ? all<CharacterRow>(
          `${select} WHERE c.system = ? AND (c.pool_room_id = ? OR c.owner_account_id IN
            (SELECT account_id FROM memberships WHERE room_id = ?)) ORDER BY c.owner_account_id IS NULL, a.username, c.name`,
          context.system,
          roomId,
          roomId
        )
      : all<CharacterRow>(
          `${select} WHERE c.system = ? AND (c.owner_account_id = ? OR
            (c.owner_account_id IS NULL AND c.pool_room_id = ?) OR
            c.id IN (SELECT active_character_id FROM memberships
              WHERE room_id = ? AND active_character_id IS NOT NULL))
            ORDER BY c.owner_account_id IS NULL, a.username, c.name`,
          context.system,
          req.account!.id,
          roomId,
          roomId
        );
  const activeCharacterId = one<{ active_character_id: number | null }>(
    "SELECT active_character_id FROM memberships WHERE room_id = ? AND account_id = ?",
    roomId,
    req.account!.id
  )?.active_character_id;
  res.json({
    characters: rows.map((row) => publicCharacter(row, roomId)),
    activeCharacterId: activeCharacterId ?? null,
    partyLabel: systemOrThrow(context.system).partyLabel,
    sheetDefinition: systemOrThrow(context.system).characterSheet,
    itemCatalogue: characterItemsFor(context.system, roomId),
    viceCatalogue: systemOrThrow(context.system).viceCatalog ? characterVicesFor(context.system) : [],
    // Null for a system that declares no creation, which is a system whose New
    // character button is the only door there has ever been and still works.
    creationDefinition: resolveCreationDefinition(context.system)
  });
});

characterRouter.post("/rooms/:roomId/characters", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const context = roomContext(req.account!.id, roomId);
  if (!context) return res.status(404).json({ error: "Room not found." });
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(80),
      sheet: sheetSchema.default({}),
      unassigned: z.boolean().default(false)
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid character." });
  if (parsed.data.unassigned && context.role !== "gm")
    return res.status(403).json({ error: "Only the room GM can create an unassigned character." });
  const ownerId = parsed.data.unassigned ? null : req.account!.id;
  const poolRoomId = parsed.data.unassigned ? roomId : null;
  db.exec("BEGIN");
  try {
    const result = db
      .prepare(
        `INSERT INTO characters (system, owner_account_id, pool_room_id, created_by, name, sheet_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(context.system, ownerId, poolRoomId, req.account!.id, parsed.data.name, JSON.stringify(parsed.data.sheet));
    const characterId = Number(result.lastInsertRowid);
    if (context.role === "player" && ownerId === req.account!.id)
      db.prepare(
        `UPDATE memberships SET active_character_id = ?
         WHERE room_id = ? AND account_id = ? AND active_character_id IS NULL`
      ).run(characterId, roomId, req.account!.id);
    db.exec("COMMIT");
    const row = one<CharacterRow>(
      `SELECT c.*, a.username AS owner_username FROM characters c
       LEFT JOIN accounts a ON a.id = c.owner_account_id WHERE c.id = ?`,
      characterId
    )!;
    broadcastCharacterChange(row);
    res.status(201).json({ character: publicCharacter(row, roomId) });
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
});

characterRouter.patch("/rooms/:roomId/characters/:characterId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const characterId = Number(req.params.characterId);
  const parsed = z
    .object({ name: z.string().trim().min(1).max(80).optional(), sheet: sheetSchema.optional() })
    .refine((value) => value.name !== undefined || value.sheet !== undefined)
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid character." });
  const result = updateCharacter(req.account!.id, roomId, characterId, parsed.data);
  if ("error" in result) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

export function updateCharacter(
  accountId: number,
  roomId: number,
  characterId: number,
  changes: { name?: string; sheet?: Record<string, unknown>; sheetPatch?: Record<string, unknown> }
): { character: ReturnType<typeof publicCharacter> } | { error: string; status: number } {
  const accessible = findAccessibleCharacter(accountId, roomId, characterId);
  if (!accessible) return { error: "Character not found.", status: 404 };

  const name = changes.name === undefined ? undefined : changes.name.trim();
  if (name !== undefined && (!name || name.length > 80))
    return { error: "Character names must be between 1 and 80 characters.", status: 400 };

  let sheet: Record<string, unknown> | undefined;
  if (changes.sheet !== undefined && !sheetSchema.safeParse(changes.sheet).success)
    return { error: "Invalid character data.", status: 400 };
  if (changes.sheetPatch !== undefined && !sheetSchema.safeParse(changes.sheetPatch).success)
    return { error: "Invalid character data.", status: 400 };
  if (changes.sheet !== undefined) sheet = changes.sheet;
  if (changes.sheetPatch !== undefined) sheet = { ...parseSheet(accessible.row.sheet_json), ...changes.sheetPatch };
  if (sheet !== undefined && !sheetSchema.safeParse(sheet).success)
    return { error: "Invalid character data.", status: 400 };
  if (name === undefined && sheet === undefined)
    return { error: "Give the character a name or sheet data.", status: 400 };

  db.prepare(
    `UPDATE characters SET name = COALESCE(?, name), sheet_json = COALESCE(?, sheet_json),
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(name ?? null, sheet ? JSON.stringify(sheet) : null, characterId);
  const row = one<CharacterRow>(
    `SELECT c.*, a.username AS owner_username FROM characters c
     LEFT JOIN accounts a ON a.id = c.owner_account_id WHERE c.id = ?`,
    characterId
  )!;
  broadcastCharacterChange(row);
  return { character: publicCharacter(row, roomId) };
}

/* -------------------------------------------------------------------------- */
/* The character builder                                                        */
/* -------------------------------------------------------------------------- */

type CreationResult = { character: ReturnType<typeof publicCharacter> } | { error: string; status: number };

type CreationAccess =
  | { row: CharacterRow; definition: CharacterCreationDefinition; draft: CreationDraft }
  | { error: string; status: number };

/**
 * All three creation routes go through `findAccessibleCharacter`, which is the
 * owner check the sheet's own PATCH already uses: a player may build their own
 * character, and a GM may build one in their room's pool. A builder is a second
 * door onto the same room and not a new permission surface, so it gets no check
 * of its own to keep in step with that one.
 */
function creationAccess(accountId: number, roomId: number, characterId: number): CreationAccess {
  const accessible = findAccessibleCharacter(accountId, roomId, characterId);
  if (!accessible) return { error: "Character not found.", status: 404 };
  const definition = systemOrThrow(accessible.row.system).characterCreation;
  if (!definition) return { error: "This system has no character creation.", status: 404 };
  const first = definition.steps.find((step) => !("automatic" in step && step.automatic)) ?? definition.steps[0];
  const draft = readCreationDraft(accessible.row.system, accessible.row.creation_json) ?? {
    system: accessible.row.system,
    stepId: first.id,
    steps: {}
  };
  return { row: accessible.row, definition, draft };
}

/** The sheet plus the character's own name, which is the one target a step may write that the sheet has not got. */
function creationTarget(row: CharacterRow): Record<string, unknown> {
  return { ...parseSheet(row.sheet_json), [CREATION_NAME_KEY]: row.name };
}

/**
 * Writes the sheet, the name, and the ledger in one statement, so a step that
 * rolled cannot land half-recorded. A character built by the wizard is
 * indistinguishable from one built by hand — decision 4 — so this writes the
 * ordinary columns and nothing else.
 */
function commitCreation(
  row: CharacterRow,
  roomId: number,
  target: Record<string, unknown>,
  draft: CreationDraft
): CreationResult {
  const { [CREATION_NAME_KEY]: name, ...sheet } = target;
  if (!sheetSchema.safeParse(sheet).success) return { error: "Invalid character data.", status: 400 };
  const named = typeof name === "string" ? name.trim().slice(0, 80) : "";
  db.prepare(
    `UPDATE characters SET name = COALESCE(?, name), sheet_json = ?, creation_json = ?,
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(named || null, JSON.stringify(sheet), JSON.stringify(draft), row.id);
  const updated = one<CharacterRow>(
    `SELECT c.*, a.username AS owner_username FROM characters c
     LEFT JOIN accounts a ON a.id = c.owner_account_id WHERE c.id = ?`,
    row.id
  )!;
  broadcastCharacterChange(updated);
  return { character: publicCharacter(updated, roomId) };
}

/**
 * Rolls one step.
 *
 * Rerolling a step that already has a result is allowed — decision 7 warns
 * rather than bars, because tables house-rule this constantly — and the ledger
 * records that it happened in `runs`. The step's previous contribution is taken
 * back out as the new one goes in, so a second roll replaces the first rather
 * than appending beside it.
 */
export function rollCreationStep(
  accountId: number,
  roomId: number,
  characterId: number,
  request: { stepId?: string; choice?: string } = {}
): CreationResult {
  const access = creationAccess(accountId, roomId, characterId);
  if ("error" in access) return access;
  const { row, definition, draft } = access;

  const available = availableCreationSteps(definition, draft);
  const stepId = request.stepId ?? draft.stepId;
  const step = available.find((candidate) => candidate.id === stepId);
  if (!step) return { error: "That is not a step this character can be on.", status: 400 };

  const target = creationTarget(row);
  const previous = draft.steps[step.id]?.applied;
  let outcome;
  try {
    outcome = performCreationStep(step, {
      system: row.system,
      roomId,
      sheet: target,
      totals: creationTotals(draft),
      records: draft.steps,
      ...(request.choice !== undefined ? { choice: request.choice } : {})
    });
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : "That step could not be rolled.", status: 400 };
  }

  const record: CreationStepRecord = {
    ...(outcome.total !== undefined ? { total: outcome.total } : {}),
    rolled: outcome.rolled,
    ...(outcome.scores ? { scores: outcome.scores } : {}),
    ...(outcome.source ? { source: outcome.source } : {}),
    ...(outcome.chosen !== undefined ? { chosen: outcome.chosen } : {}),
    ...(outcome.candidates?.length ? { candidates: outcome.candidates } : {}),
    ...(outcome.save ? { save: outcome.save } : {}),
    ...(outcome.skipped ? { skipped: true } : { applied: outcome.applied }),
    runs: (draft.steps[step.id]?.runs ?? 0) + 1
  };
  draft.steps[step.id] = record;
  draft.stepId = step.id;

  let next = outcome.skipped
    ? previous
      ? revertCreationWrite(target, previous)
      : target
    : applyCreationWrite(target, outcome.applied, previous);

  // A rerolled save that lands the other way takes its branch back with it.
  // Leaving the vice a failure wrote on the sheet after a success would make
  // the sheet disagree with the ledger that produced it.
  if (step.kind === "save" && !outcome.save?.matched) {
    for (const nested of step.then) {
      const wrote = draft.steps[nested.id];
      if (!wrote?.applied) continue;
      next = revertCreationWrite(next, wrote.applied);
      draft.steps[nested.id] = { ...wrote, applied: undefined, skipped: true };
    }
  }

  return commitCreation(row, roomId, next, draft);
}

export interface CreationChange {
  stepId: string;
  /** Where the rolled numbers go, for a `roll-scores` that lets the player rearrange them. */
  assign?: number[];
  /** Where the declared array's numbers go, for a `roll-scores` that offers one instead of rolling. */
  array?: number[];
  /** What the player typed, for a `text` step. */
  text?: string;
  /** The gear candidates the player kept, by the book's own wording. */
  take?: string[];
  /** The reviewed candidates the player filed as character description instead. */
  describe?: string[];
  /** The reviewed candidates the player filed into the step's `entries` field — a talent rather than gear. */
  entry?: string[];
  /** Passing on a step, or taking that back. A skipped step writes nothing. */
  skip?: boolean;
}

/** Records a choice, a score assignment, a skip, or a move between steps. */
export function updateCreationDraft(
  accountId: number,
  roomId: number,
  characterId: number,
  change: CreationChange
): CreationResult {
  const access = creationAccess(accountId, roomId, characterId);
  if ("error" in access) return access;
  const { row, definition, draft } = access;

  const step = availableCreationSteps(definition, draft).find((candidate) => candidate.id === change.stepId);
  if (!step) return { error: "That is not a step this character can be on.", status: 400 };

  const target = creationTarget(row);
  const record: CreationStepRecord = { ...draft.steps[step.id] };
  const previous = record.applied;
  let next = target;
  draft.stepId = step.id;

  if (change.skip !== undefined) {
    // A skipped step writes nothing, which for one that has already written
    // means taking what it wrote back out again — and taking the skip back puts
    // it in again. The ledger keeps the write through both, because it is the
    // record of what the step decided rather than a copy of the sheet: a
    // `roll-scores` step that came back without one would have its numbers
    // sitting on the sheet and nothing anywhere saying it put them there.
    if (change.skip && previous) next = revertCreationWrite(target, previous);
    if (!change.skip && record.skipped && previous) next = applyCreationWrite(target, previous);
    record.skipped = change.skip;
  }

  // The two ways a `roll-scores` step may be filled in. Placing the dice needs
  // dice to have been thrown; taking the array needs no roll at all, which is
  // the whole of what makes it the other way rather than a third rearrangement.
  const placed = change.assign ? ("rolled" as const) : change.array ? ("array" as const) : undefined;
  const values = change.assign ?? change.array;
  if (placed && values) {
    if (step.kind !== "roll-scores") return { error: "Only a step that rolls scores assigns them.", status: 400 };
    const rolled = (record.scores ?? []).map((score) => score.total);
    if (placed === "rolled" && !rolled.length)
      return { error: "Roll this step's scores before placing them.", status: 400 };
    const refusal = refuseScoreAssignment(step, placed, rolled, values);
    if (refusal) return { error: refusal, status: 400 };
    const write = { set: scoreAssignment(step, values) };
    next = applyCreationWrite(next, write, previous);
    record.applied = write;
    record.source = placed;
    // Taking the array puts the dice away: the numbers on the sheet are the
    // book's, and a `substitute` offered on the rolled path is not on this one.
    if (placed === "array") record.scores = undefined;
    record.skipped = false;
  }

  if (change.text !== undefined) {
    if (step.kind !== "text" && !(step.kind === "roll-table" && step.editable && step.joinInto))
      return { error: "This step does not accept a custom value.", status: 400 };
    const write: CreationWrite =
      step.kind === "text"
        ? { set: { [step.field]: change.text } }
        : {
            ...record.applied,
            join: [
              ...(record.applied?.join ?? []).filter((entry) => entry.field !== step.joinInto!.field),
              {
                field: step.joinInto!.field,
                separator: step.joinInto!.separator,
                lines: step.editable!.multiline
                  ? change.text
                      .split(/\r?\n/)
                      .map((line) => line.trim())
                      .filter(Boolean)
                  : [change.text.trim()]
              }
            ]
          };
    next = applyCreationWrite(next, write, previous);
    record.applied = write;
    record.chosen = change.text;
    record.skipped = false;
  }

  if (change.take !== undefined || change.describe !== undefined || change.entry !== undefined) {
    // One result goes to one place. The three destinations are drawn as one
    // choice, so a payload naming the same line twice is a client that has lost
    // track of what the player pressed rather than something to reconcile here.
    const destinations: [string, readonly string[] | undefined][] = [
      ["inventory", change.take],
      ["description", change.describe],
      ["talents", change.entry]
    ];
    for (const [name, chosen] of destinations)
      for (const [other, against] of destinations) {
        if (chosen === against || !chosen || !against) continue;
        const overlap = chosen.find((text) => against.includes(text));
        if (overlap) return { error: `"${overlap}" cannot be added to both ${name} and ${other}.`, status: 400 };
      }

    const stowed = change.take === undefined ? undefined : takeCandidates(record, change.take);
    if (stowed && "error" in stowed) return { error: stowed.error, status: 400 };
    const described = change.describe === undefined ? undefined : describeCandidates(step, record, change.describe);
    if (described && "error" in described) return { error: described.error, status: 400 };
    const entered = change.entry === undefined ? undefined : entryCandidates(step, record, change.entry);
    if (entered && "error" in entered) return { error: entered.error, status: 400 };

    const candidateItems = new Set((record.candidates ?? []).map((candidate) => candidate.label ?? candidate.text));
    // An entry is a record rather than a line, so it is recognised by its
    // content the way `applyCreationWrite` removes one. Comparing `String(item)`
    // would call every one of them "[object Object]" and leave a talent on the
    // sheet after the player had moved it somewhere else.
    const candidateEntries = new Set(
      (record.candidates ?? []).map((candidate) => JSON.stringify(creationEntryFrom(candidate.text)))
    );
    const fixedItems = new Set(
      step.kind === "grant"
        ? (step.items ?? []).map(
            (item) => matchCatalogueItem(characterItemsFor(row.system, roomId), item, step.listKey)?.item.label ?? item
          )
        : []
    );
    const byList = new Map<string, unknown[]>();
    for (const entry of record.applied?.stow ?? [])
      byList.set(
        entry.key,
        entry.items.filter(
          (item) =>
            fixedItems.has(String(item)) ||
            (!candidateItems.has(String(item)) && !candidateEntries.has(JSON.stringify(item)))
        )
      );
    for (const stow of [...(stowed?.stow ?? []), ...(entered?.stow ?? [])])
      byList.set(stow.key, [...(byList.get(stow.key) ?? []), ...stow.items]);

    const joins = [...(record.applied?.join ?? [])];
    if (described) {
      const retained = joins.filter((entry) => entry.field !== described.join.field);
      joins.splice(0, joins.length, ...retained, described.join);
    }
    const write: CreationWrite = {
      ...record.applied,
      ...(change.take !== undefined || change.entry !== undefined
        ? { stow: [...byList].map(([key, items]) => ({ key, items })) }
        : {}),
      ...(described ? { join: joins } : {})
    };
    next = applyCreationWrite(next, write, previous);
    record.applied = write;
    record.skipped = false;
  }

  draft.steps[step.id] = record;
  return commitCreation(row, roomId, next, draft);
}

/**
 * The gear a player kept out of what the book's prose offered.
 *
 * Each candidate already knows where it would go: the step's own `listKey`, or
 * the list the catalogue entry it matched belongs to. One that knows neither is
 * refused rather than filed somewhere plausible — the sheet's first list is a
 * guess, and a guess is wrong on any sheet with two, which Monolith's equipment
 * and augmentations already are.
 */
function takeCandidates(
  record: CreationStepRecord,
  taken: readonly string[]
): { stow: { key: string; items: string[] }[] } | { error: string } {
  const byList = new Map<string, string[]>();
  for (const text of taken) {
    const candidate = (record.candidates ?? []).find((entry) => entry.text === text);
    if (!candidate) return { error: `"${text}" is not one of the things this step offered.` };
    if (!candidate.listKey)
      return { error: `"${text}" matches nothing in the catalogue, so put it in a slot in your own words.` };
    byList.set(candidate.listKey, [...(byList.get(candidate.listKey) ?? []), candidate.label ?? candidate.text]);
  }
  return { stow: [...byList].map(([key, items]) => ({ key, items })) };
}

/** Files reviewed results as prose, using the same authored text the player saw. */
function describeCandidates(
  step: CreationStep,
  record: CreationStepRecord,
  selected: readonly string[]
): { join: { field: string; separator: string; lines: string[] } } | { error: string } {
  const target = step.kind === "grant" ? step.describeInto : step.kind === "roll-table" ? step.joinInto : undefined;
  if (!target) return { error: "This step does not offer a description destination." };
  const lines: string[] = [];
  for (const text of selected) {
    const candidate = (record.candidates ?? []).find((entry) => entry.text === text);
    if (!candidate) return { error: `"${text}" is not one of the things this step offered.` };
    lines.push(candidate.description ?? candidate.text);
  }
  return { join: { field: target.field, separator: target.separator, lines } };
}

/**
 * Files reviewed results in the sheet's own `entries` field — Monolith's
 * Talents panel, for the talent its backgrounds roll.
 *
 * The split into a name and what it does is `creationEntryFrom`, which is
 * shared so the title the player was shown before they pressed the button is
 * the title that lands on the sheet. The book's own words are what is parsed:
 * a joined line carries the table's name in front of it, and a talent called
 * "Pilot - Other Talents" is the caption rather than the talent.
 */
function entryCandidates(
  step: CreationStep,
  record: CreationStepRecord,
  selected: readonly string[]
): { stow: { key: string; items: CharacterEntry[] }[] } | { error: string } {
  const field = creationStepEntryField(step);
  if (!field) return { error: "This step does not offer an entries destination." };
  const items: CharacterEntry[] = [];
  for (const text of selected) {
    const candidate = (record.candidates ?? []).find((entry) => entry.text === text);
    if (!candidate) return { error: `"${text}" is not one of the things this step offered.` };
    items.push(creationEntryFrom(candidate.text));
  }
  return { stow: [{ key: field, items }] };
}

/** Drops the draft. What remains is a sheet, which is decision 4 in one statement. */
export function finishCreation(accountId: number, roomId: number, characterId: number): CreationResult {
  const accessible = findAccessibleCharacter(accountId, roomId, characterId);
  if (!accessible) return { error: "Character not found.", status: 404 };
  const definition = systemOrThrow(accessible.row.system).characterCreation;
  const draft = readCreationDraft(accessible.row.system, accessible.row.creation_json);
  let target = creationTarget(accessible.row);
  for (const step of definition?.steps ?? []) {
    if (!("automatic" in step && step.automatic)) continue;
    const outcome = performCreationStep(step, {
      system: accessible.row.system,
      roomId,
      sheet: target,
      totals: creationTotals(draft),
      records: draft?.steps
    });
    target = applyCreationWrite(target, outcome.applied);
  }
  const { [CREATION_NAME_KEY]: name, ...sheet } = target;
  if (!sheetSchema.safeParse(sheet).success) return { error: "Invalid character data.", status: 400 };
  const named = typeof name === "string" ? name.trim().slice(0, 80) : "";
  db.prepare(
    `UPDATE characters SET name = COALESCE(?, name), sheet_json = ?, creation_json = NULL,
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(named || null, JSON.stringify(sheet), accessible.row.id);
  const row = one<CharacterRow>(
    `SELECT c.*, a.username AS owner_username FROM characters c
     LEFT JOIN accounts a ON a.id = c.owner_account_id WHERE c.id = ?`,
    accessible.row.id
  )!;
  broadcastCharacterChange(row);
  return { character: publicCharacter(row, roomId) };
}

const creationRollSchema = z
  .object({ stepId: z.string().max(80).optional(), choice: z.string().max(200).optional() })
  .default({});

const creationChangeSchema = z
  .object({
    stepId: z.string().max(80),
    assign: z.array(z.number().int().min(-100).max(1000)).max(20).optional(),
    array: z.array(z.number().int().min(-100).max(1000)).max(20).optional(),
    text: z.string().max(2000).optional(),
    take: z.array(z.string().max(400)).max(50).optional(),
    describe: z.array(z.string().max(400)).max(50).optional(),
    entry: z.array(z.string().max(400)).max(50).optional(),
    skip: z.boolean().optional()
  })
  .strict();

characterRouter.post("/rooms/:roomId/characters/:characterId/creation/roll", requireAuth, (req: AuthedRequest, res) => {
  const parsed = creationRollSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid creation step." });
  const result = rollCreationStep(
    req.account!.id,
    Number(req.params.roomId),
    Number(req.params.characterId),
    parsed.data
  );
  if ("error" in result) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

characterRouter.patch("/rooms/:roomId/characters/:characterId/creation", requireAuth, (req: AuthedRequest, res) => {
  const parsed = creationChangeSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid change." });
  const result = updateCreationDraft(
    req.account!.id,
    Number(req.params.roomId),
    Number(req.params.characterId),
    parsed.data
  );
  if ("error" in result) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

characterRouter.post(
  "/rooms/:roomId/characters/:characterId/creation/finish",
  requireAuth,
  (req: AuthedRequest, res) => {
    const result = finishCreation(req.account!.id, Number(req.params.roomId), Number(req.params.characterId));
    if ("error" in result) return res.status(result.status).json({ error: result.error });
    res.json(result);
  }
);

characterRouter.get("/rooms/:roomId/characters/:characterId/portrait", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const characterId = Number(req.params.characterId);
  const visible = findVisibleCharacter(req.account!.id, roomId, characterId);
  if (!visible?.row.portrait_stored_name || !visible.row.portrait_mime_type)
    return res.status(404).json({ error: "Character portrait not found." });
  if (path.basename(visible.row.portrait_stored_name) !== visible.row.portrait_stored_name)
    return res.status(404).json({ error: "Character portrait not found." });
  res.type(visible.row.portrait_mime_type);
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.setHeader(
    "Content-Disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(visible.row.portrait_filename ?? "portrait")}`
  );
  res.sendFile(visible.row.portrait_stored_name, { root: uploadsDir });
});

characterRouter.post(
  "/rooms/:roomId/characters/:characterId/portrait",
  requireAuth,
  portraitUpload.single("file"),
  (req: AuthedRequest, res) => {
    const roomId = Number(req.params.roomId);
    const characterId = Number(req.params.characterId);
    const accessible = findAccessibleCharacter(req.account!.id, roomId, characterId);
    if (!accessible) {
      removeUploadedPortrait(req.file);
      return res.status(404).json({ error: "Character not found." });
    }
    if (!req.file) return res.status(400).json({ error: "Choose a PNG, JPEG, or WebP portrait." });
    if (!validPortraitFile(req.file)) {
      removeUploadedPortrait(req.file);
      return res.status(415).json({ error: "The file contents do not match a supported image format." });
    }
    const used = storedUploadBytes();
    const replacedBytes = accessible.row.portrait_size ?? 0;
    if (used - replacedBytes + req.file.size > config.uploadLimitMb * 1024 * 1024) {
      removeUploadedPortrait(req.file);
      return res.status(413).json({ error: "The server upload-storage allowance has been reached." });
    }

    const previousStoredName = accessible.row.portrait_stored_name;
    try {
      db.prepare(
        `UPDATE characters
         SET portrait_filename = ?, portrait_stored_name = ?, portrait_mime_type = ?, portrait_size = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(
        path.basename(req.file.originalname).slice(0, 200) || `portrait${portraitImageTypes.get(req.file.mimetype)}`,
        req.file.filename,
        req.file.mimetype,
        req.file.size,
        characterId
      );
    } catch (error) {
      removeUploadedPortrait(req.file);
      throw error;
    }
    if (previousStoredName !== req.file.filename) removeStoredPortrait(previousStoredName);

    const row = one<CharacterRow>(
      `SELECT c.*, a.username AS owner_username FROM characters c
       LEFT JOIN accounts a ON a.id = c.owner_account_id WHERE c.id = ?`,
      characterId
    )!;
    broadcastCharacterChange(row);
    res.status(201).json({ character: publicCharacter(row, roomId) });
  }
);

characterRouter.delete("/rooms/:roomId/characters/:characterId/portrait", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const characterId = Number(req.params.characterId);
  const accessible = findAccessibleCharacter(req.account!.id, roomId, characterId);
  if (!accessible) return res.status(404).json({ error: "Character not found." });
  const previousStoredName = accessible.row.portrait_stored_name;
  db.prepare(
    `UPDATE characters
       SET portrait_filename = NULL, portrait_stored_name = NULL, portrait_mime_type = NULL, portrait_size = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
  ).run(characterId);
  removeStoredPortrait(previousStoredName);
  const row = one<CharacterRow>(
    `SELECT c.*, a.username AS owner_username FROM characters c
       LEFT JOIN accounts a ON a.id = c.owner_account_id WHERE c.id = ?`,
    characterId
  )!;
  broadcastCharacterChange(row);
  res.json({ character: publicCharacter(row, roomId) });
});

characterRouter.delete("/rooms/:roomId/characters/:characterId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const characterId = Number(req.params.characterId);
  const accessible = findAccessibleCharacter(req.account!.id, roomId, characterId);
  if (!accessible) return res.status(404).json({ error: "Character not found." });
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE memberships SET active_character_id = NULL WHERE active_character_id = ?").run(characterId);
    db.prepare("DELETE FROM characters WHERE id = ?").run(characterId);
    db.exec("COMMIT");
    removeStoredPortrait(accessible.row.portrait_stored_name);
    broadcastCharacterChange(accessible.row);
    res.status(204).end();
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
});

characterRouter.post("/rooms/:roomId/characters/:characterId/claim", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const characterId = Number(req.params.characterId);
  const context = roomContext(req.account!.id, roomId);
  if (!context) return res.status(404).json({ error: "Room not found." });
  if (context.role !== "player") return res.status(403).json({ error: "Only players can claim pool characters." });
  const original = one<CharacterRow>(
    `SELECT c.*, NULL AS owner_username FROM characters c
     WHERE c.id = ? AND c.system = ? AND c.owner_account_id IS NULL AND c.pool_room_id = ?`,
    characterId,
    context.system,
    roomId
  );
  if (!original) return res.status(409).json({ error: "That character is no longer available to claim." });
  db.exec("BEGIN");
  try {
    const changed = db
      .prepare(
        `UPDATE characters SET owner_account_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND owner_account_id IS NULL AND pool_room_id = ?`
      )
      .run(req.account!.id, characterId, roomId);
    if (!changed.changes) {
      db.exec("ROLLBACK");
      return res.status(409).json({ error: "That character was just claimed by someone else." });
    }
    db.prepare("UPDATE memberships SET active_character_id = ? WHERE room_id = ? AND account_id = ?").run(
      characterId,
      roomId,
      req.account!.id
    );
    db.exec("COMMIT");
    const row = one<CharacterRow>(
      `SELECT c.*, a.username AS owner_username FROM characters c
       LEFT JOIN accounts a ON a.id = c.owner_account_id WHERE c.id = ?`,
      characterId
    )!;
    broadcastCharacterChange(original);
    broadcastCharacterChange(row);
    res.json({ character: publicCharacter(row, roomId), activeCharacterId: characterId });
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
});

characterRouter.post("/rooms/:roomId/characters/:characterId/unassign", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const characterId = Number(req.params.characterId);
  const accessible = findAccessibleCharacter(req.account!.id, roomId, characterId);
  if (!accessible || accessible.context.role !== "gm")
    return res.status(403).json({ error: "Only the room GM can unassign characters." });
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE memberships SET active_character_id = NULL WHERE active_character_id = ?").run(characterId);
    db.prepare(
      `UPDATE characters SET owner_account_id = NULL, pool_room_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(roomId, characterId);
    db.exec("COMMIT");
    const row = one<CharacterRow>(`SELECT c.*, NULL AS owner_username FROM characters c WHERE c.id = ?`, characterId)!;
    broadcastCharacterChange(accessible.row);
    broadcastCharacterChange(row);
    res.json({ character: publicCharacter(row, roomId) });
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
});

characterRouter.patch("/rooms/:roomId/active-character", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const context = roomContext(req.account!.id, roomId);
  if (!context) return res.status(404).json({ error: "Room not found." });
  const parsed = z.object({ characterId: z.number().int().positive().nullable() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a valid character." });
  if (parsed.data.characterId !== null) {
    const character = one<{ id: number }>(
      "SELECT id FROM characters WHERE id = ? AND system = ? AND owner_account_id = ?",
      parsed.data.characterId,
      context.system,
      req.account!.id
    );
    if (!character)
      return res.status(403).json({ error: "You can only activate one of your own compatible characters." });
  }
  db.prepare("UPDATE memberships SET active_character_id = ? WHERE room_id = ? AND account_id = ?").run(
    parsed.data.characterId,
    roomId,
    req.account!.id
  );
  broadcastRoom(roomId, { type: "characters-updated" });
  refreshRoomPresence(roomId);
  res.json({ activeCharacterId: parsed.data.characterId });
});

characterRouter.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error instanceof multer.MulterError) {
    return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      error: error.code === "LIMIT_FILE_SIZE" ? "Character portraits may be at most 5 MB." : error.message
    });
  }
  if (error instanceof Error && error.message.includes("PNG, JPEG, and WebP portraits"))
    return res.status(415).json({ error: error.message });
  next(error);
});
