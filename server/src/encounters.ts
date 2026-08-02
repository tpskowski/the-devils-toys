import express from "express";
import { z } from "zod";
import {
  classifyItem,
  itemDamage,
  itemRange,
  splitItemLabel,
  weaponsInHand,
  type ItemClassification,
  type SystemId
} from "@devils-toys/shared";
import type { AuthedRequest } from "./auth.js";
import { requireAuth, roomRole } from "./auth.js";
import { all, db, one } from "./db.js";
import {
  findAccessibleCharacter,
  findVisibleCharacter,
  publicCharacter,
  updateCharacter,
  type CharacterRow
} from "./characters.js";
import { rollDice } from "./dice.js";
import { parseGroupState, updateHireling } from "./group.js";
import { broadcastRoom } from "./realtime.js";
import { npcCatalog } from "./npcs.js";
import { parseNpcStatblock } from "./npc-statblocks.js";
import { systems } from "./systems.js";

export const encounterRouter = express.Router();

interface EncounterRow {
  id: number;
  room_id: number;
  name: string;
  active: number;
  media_id: number | null;
  notes: string;
  display: "map" | "zones";
  individual_initiative: number;
  created_by: number;
  created_at: string;
  updated_at: string;
}

interface CombatantRow {
  id: number;
  encounter_id: number;
  kind: "character" | "hireling" | "npc";
  character_id: number | null;
  npc_id: number | null;
  hireling_id: string | null;
  name: string;
  side: string;
  initiative: number | null;
  acts_first_turn: number | null;
  sort_order: number;
  zone_id: number | null;
  hp_current: number | null;
  hp_max: number | null;
  statblock_json: string;
  conditions: string;
  included: number;
}

interface MediaRow {
  id: number;
  room_id: number;
  kind: "map" | "scene" | "reference" | "audio";
  filename: string;
  display_name: string | null;
  visible: number;
}

function jsonObject(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function sidesFor(system: SystemId) {
  return systems[system].initiative.sides ?? [];
}

function validSide(system: SystemId, side: string) {
  return sidesFor(system).some((candidate) => candidate.id === side);
}

function roomSystem(accountId: number, roomId: number) {
  const role = roomRole(accountId, roomId);
  const room = one<{ system: SystemId }>("SELECT system FROM rooms WHERE id = ?", roomId);
  return role && room ? { role, system: room.system } : undefined;
}

function gmRoom(req: AuthedRequest, res: express.Response) {
  const roomId = Number(req.params.roomId);
  if (!Number.isInteger(roomId) || roomRole(req.account!.id, roomId) !== "gm") {
    res.status(403).json({ error: "Only the room GM can manage encounters." });
    return;
  }
  return roomId;
}

function mediaFor(roomId: number, mediaId: number | null | undefined) {
  if (mediaId == null) return null;
  return one<MediaRow>(
    "SELECT id, room_id, kind, filename, display_name, visible FROM media WHERE id = ? AND room_id = ?",
    mediaId,
    roomId
  );
}

function validateMedia(roomId: number, mediaId: number | null | undefined) {
  if (mediaId == null) return { media: null as MediaRow | null };
  const media = mediaFor(roomId, mediaId);
  if (!media || (media.kind !== "map" && media.kind !== "scene"))
    return { error: "Encounter images must be map or scene assets." };
  return { media };
}

function hpKeys(system: SystemId, hireling: boolean) {
  const definition = hireling ? systems[system].groupPage?.hirelings?.sheet : systems[system].characterSheet;
  const fields = definition?.sections.flatMap((section) => section.fields) ?? [];
  return {
    current: fields.some((field) => field.key === "hpCurrent") ? "hpCurrent" : undefined,
    maximum: fields.some((field) => field.key === "hpMax") ? "hpMax" : undefined
  };
}

/**
 * What a sheet keeps armor under, where it keeps any. Read by convention as hit
 * points are: Monolith tracks armor as a current and a maximum, Cairn as one
 * number, and neither system's hirelings wear any.
 */
function sheetArmor(system: SystemId, sheet: Record<string, unknown>, hireling: boolean) {
  const definition = hireling ? systems[system].groupPage?.hirelings?.sheet : systems[system].characterSheet;
  const fields = new Set(definition?.sections.flatMap((section) => section.fields.map((field) => field.key)) ?? []);
  const key = ["armorCurrent", "armor"].find((candidate) => fields.has(candidate));
  const raw = key === undefined ? undefined : sheet[key];
  if (raw === null || raw === "") return undefined;
  const value = raw === undefined ? undefined : Number(raw);
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

/**
 * Whether this one is marked, where the system marks anyone. The same key serves
 * a sheet and a statblock, since it is one state rather than a score.
 */
function markedCritical(system: SystemId, fields: Record<string, unknown>) {
  const key = systems[system].attributeDamage?.criticalDamage?.key;
  return key ? fields[key] === true : undefined;
}

/** The armor a creature's own statblock states, in the field the system names. */
function statblockArmor(system: SystemId, fields: Record<string, unknown>) {
  const key = systems[system].npcStatblock.armorKey;
  const raw = key === undefined ? undefined : fields[key];
  if (raw === null || raw === "") return undefined;
  const value = raw === undefined ? undefined : Number(raw);
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

/**
 * Turns `{ str: 7 }` into the keys the target actually stores, refusing an
 * attribute the system does not spend or a sheet that has no field for it.
 */
function attributePatch(
  system: SystemId,
  kind: CombatantRow["kind"],
  attributes: Record<string, number>
): { patch: Record<string, number> } | { error: string } {
  const definition = systems[system].attributeDamage;
  if (!definition) return { error: "This system does not track attribute damage." };
  const sheet =
    kind === "npc"
      ? undefined
      : kind === "hireling"
        ? systems[system].groupPage?.hirelings?.sheet
        : systems[system].characterSheet;
  const fields = new Set(sheet?.sections.flatMap((section) => section.fields.map((field) => field.key)) ?? []);
  const patch: Record<string, number> = {};
  for (const [id, value] of Object.entries(attributes)) {
    const attribute = definition.attributes.find((candidate) => candidate.id === id);
    if (!attribute) return { error: "Unknown attribute." };
    const key = kind === "npc" ? attribute.statblockKey : attribute.currentKey;
    if (!key || (kind !== "npc" && !fields.has(key))) return { error: `Nothing here records ${attribute.label}.` };
    patch[key] = value;
  }
  return { patch };
}

function weaponPayload(weapon: { name: string; held: ItemClassification }) {
  return {
    name: weapon.name,
    ...(weapon.held.damage ? { damage: weapon.held.damage } : {}),
    ...(weapon.held.traits?.length ? { traits: weapon.held.traits } : {}),
    ...(weapon.held.range ? { range: weapon.held.range } : {}),
    ...(weapon.held.notes ? { notes: weapon.held.notes } : {})
  };
}

/**
 * What a sheet has in hand, so the rail can put it beside the name: the weapon
 * chosen from those within reach, and the second one where they are fighting
 * with both. Read on the server because a hireling's sheet is not sent to
 * players, who may still roll one's attack.
 */
function sheetWeapons(system: SystemId, sheet: Record<string, unknown>, hireling: boolean) {
  const definition = hireling ? systems[system].groupPage?.hirelings?.sheet : systems[system].characterSheet;
  const list = definition?.lists[0];
  if (!list) return {};
  const { main, offhand } = weaponsInHand(sheet, list);
  return {
    ...(main ? { weapon: weaponPayload(main) } : {}),
    ...(offhand ? { offhand: weaponPayload(offhand) } : {})
  };
}

/** What a creature attacks with, from the one statblock field that says so. */
function statblockWeapon(system: SystemId, fields: Record<string, unknown>) {
  const statblock = systems[system].npcStatblock;
  const attacks = statblock.attacksKey ? String(fields[statblock.attacksKey] ?? "").trim() : "";
  if (!attacks) return undefined;
  const weaponRange = statblock.weaponRange;
  const { name, spec, trailing } = splitItemLabel(attacks);
  // A statblock usually writes an attack the way a slot does — "Laser Rifle
  // (D8 thermal)" — and the parenthetical is read as any other weapon's is.
  if (spec) {
    const held = classifyItem({ name, spec, detail: trailing, weaponRange });
    return {
      name: (name || attacks).slice(0, 60),
      ...(held.damage ? { damage: held.damage } : {}),
      ...(held.traits?.length ? { traits: held.traits } : {}),
      ...(held.range ? { range: held.range } : {})
    };
  }
  // Some bestiary lines state it bare, as "D6 Bite". There the die is the damage
  // and what is left is what the thing is called; none of it is a trait.
  const damage = itemDamage(attacks);
  const bare = damage ? attacks.replace(damage, "").trim() : attacks;
  return {
    name: (bare || attacks).slice(0, 60),
    ...(damage ? { damage } : {}),
    range: itemRange({ name: bare }, weaponRange)
  };
}

function statblock(value: string | null | undefined) {
  return jsonObject(value);
}

function hirelingFromState(state: Record<string, unknown>, id: string) {
  if (!Array.isArray(state.hirelings)) return;
  return state.hirelings.find((entry): entry is Record<string, unknown> =>
    Boolean(entry && typeof entry === "object" && !Array.isArray(entry) && entry.id === id)
  );
}

/**
 * Hireling portraits, keyed by hireling id. They live in their own table rather
 * than the group blob, so the roster has to look them up separately.
 */
function hirelingImages(roomId: number) {
  return new Map(
    all<{ hireling_id: string; stored_name: string }>(
      "SELECT hireling_id, stored_name FROM hireling_images WHERE room_id = ?",
      roomId
    ).map((row) => [
      row.hireling_id,
      `/api/rooms/${roomId}/group/hirelings/${encodeURIComponent(row.hireling_id)}/image?v=${encodeURIComponent(row.stored_name)}`
    ])
  );
}

/**
 * The encounter's own image. Unlike the Library, this ignores the asset's
 * visibility: a map is put on the encounter tab to be looked at, and doing so
 * says nothing about whether the Maps tab has revealed it. The two are separate
 * decisions, and neither changes the other.
 */
function publicMedia(roomId: number, media: MediaRow | null) {
  if (!media) return null;
  return {
    id: media.id,
    roomId,
    kind: media.kind,
    filename: media.filename,
    displayName: media.display_name,
    visible: Boolean(media.visible),
    url: `/api/media/${media.id}/file`
  };
}

/** Build the encounter as seen by one account. All player filtering happens here. */
export function visibleEncounter(accountId: number, roomId: number, encounterId: number) {
  const context = roomSystem(accountId, roomId);
  if (!context) return;
  const encounter = one<EncounterRow>("SELECT * FROM encounters WHERE id = ? AND room_id = ?", encounterId, roomId);
  if (!encounter || (context.role === "player" && !encounter.active)) return;
  const state = parseGroupState(
    one<{ group_json: string }>("SELECT group_json FROM room_state WHERE room_id = ?", roomId)?.group_json
  );
  const rows = all<CombatantRow>(
    "SELECT * FROM encounter_combatants WHERE encounter_id = ? ORDER BY sort_order, id",
    encounterId
  );
  const portraits = hirelingImages(roomId);
  const combatants: Record<string, unknown>[] = rows.flatMap((row): Record<string, unknown>[] => {
    const common = {
      id: row.id,
      kind: row.kind,
      name: row.name,
      side: row.side,
      initiative: row.initiative,
      actsFirstTurn: row.acts_first_turn === null ? null : Boolean(row.acts_first_turn),
      sortOrder: row.sort_order,
      included: Boolean(row.included),
      zoneId: row.zone_id,
      conditions: context.role === "gm" ? row.conditions : undefined
    };
    if (row.kind === "character") {
      if (row.character_id === null) return [];
      const visible = findVisibleCharacter(accountId, roomId, row.character_id);
      if (!visible) return [];
      const character = publicCharacter(visible.row as CharacterRow, roomId);
      return [
        {
          ...common,
          sourceId: row.character_id,
          name: character.name,
          imageUrl: character.portraitUrl,
          hpCurrent: character.sheet.hpCurrent ?? null,
          hpMax: character.sheet.hpMax ?? null,
          armor: sheetArmor(context.system, character.sheet as Record<string, unknown>, false),
          criticalDamage: markedCritical(context.system, character.sheet as Record<string, unknown>),
          ...sheetWeapons(context.system, character.sheet as Record<string, unknown>, false),
          character
        }
      ];
    }
    if (row.kind === "hireling") {
      if (!row.hireling_id) return [];
      const hireling = hirelingFromState(state, row.hireling_id);
      if (!hireling) return [];
      const sheet = hireling;
      return [
        {
          ...common,
          sourceId: row.hireling_id,
          name: String(hireling.name ?? row.name),
          imageUrl: portraits.get(row.hireling_id) ?? null,
          hpCurrent: sheet.hpCurrent ?? null,
          hpMax: sheet.hpMax ?? null,
          armor: sheetArmor(context.system, sheet, true),
          criticalDamage: markedCritical(context.system, sheet),
          ...sheetWeapons(context.system, sheet, true),
          hireling: context.role === "gm" ? hireling : undefined
        }
      ];
    }
    // NPCs have no image store of their own yet, so they always fall back to the
    // initial the client draws in place of a portrait.
    return [
      {
        ...common,
        sourceId: row.npc_id,
        imageUrl: null,
        hpCurrent: context.role === "gm" ? row.hp_current : undefined,
        hpMax: context.role === "gm" ? row.hp_max : undefined,
        // What a creature wears and what it is swinging are plain to anyone in the
        // room with it, so the whole table sees them. How much fight is left in it
        // is not, and stays with the rest of its statblock.
        armor: statblockArmor(context.system, statblock(row.statblock_json)),
        criticalDamage: markedCritical(context.system, statblock(row.statblock_json)),
        weapon: statblockWeapon(context.system, statblock(row.statblock_json)),
        statblock: context.role === "gm" ? statblock(row.statblock_json) : undefined,
        npcId: context.role === "gm" ? row.npc_id : undefined
      }
    ];
  });
  const media = publicMedia(roomId, mediaFor(roomId, encounter.media_id) ?? null);
  return {
    id: encounter.id,
    name: encounter.name,
    active: Boolean(encounter.active),
    media,
    notes: context.role === "gm" ? encounter.notes : undefined,
    display: encounter.display === "zones" ? "zones" : "map",
    zones: all<{ id: number; name: string; sortOrder: number }>(
      "SELECT id, name, sort_order AS sortOrder FROM encounter_zones WHERE encounter_id = ? ORDER BY sort_order, id",
      encounter.id
    ),
    individualInitiative: Boolean(encounter.individual_initiative),
    sides: all<{ side: string; initiative: number | null }>(
      "SELECT side, initiative FROM encounter_sides WHERE encounter_id = ? ORDER BY rowid",
      encounter.id
    ),
    combatants,
    initiative: systems[context.system].initiative,
    // The rail renders a statblock from this rather than guessing at field names.
    npcStatblock: context.role === "gm" ? systems[context.system].npcStatblock : undefined,
    // Not GM-only: a player spends their own character's attributes from the rail.
    attributeDamage: systems[context.system].attributeDamage,
    rangedWeaponIcon: systems[context.system].rangedWeaponIcon,
    system: context.system,
    role: context.role
  };
}

function encounterForGm(accountId: number, roomId: number, encounterId: number) {
  if (roomRole(accountId, roomId) !== "gm") return;
  const context = roomSystem(accountId, roomId);
  const encounter = one<EncounterRow>("SELECT * FROM encounters WHERE id = ? AND room_id = ?", encounterId, roomId);
  return context && encounter ? { context, encounter } : undefined;
}

encounterRouter.get("/rooms/:roomId/encounters", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const context = roomSystem(req.account!.id, roomId);
  if (!context) return res.status(404).json({ error: "Room not found." });
  const ids = all<{ id: number }>(
    `SELECT id FROM encounters WHERE room_id = ? ${context.role === "player" ? "AND active = 1" : ""} ORDER BY active DESC, updated_at DESC, id DESC`,
    roomId
  );
  res.json({ encounters: ids.map((row) => visibleEncounter(req.account!.id, roomId, row.id)).filter(Boolean) });
});

encounterRouter.get("/rooms/:roomId/encounters/:encounterId", requireAuth, (req: AuthedRequest, res) => {
  const value = visibleEncounter(req.account!.id, Number(req.params.roomId), Number(req.params.encounterId));
  if (!value) return res.status(404).json({ error: "Encounter not found." });
  res.json({ encounter: value });
});

encounterRouter.post("/rooms/:roomId/encounters", requireAuth, (req: AuthedRequest, res) => {
  const roomId = gmRoom(req, res);
  if (!roomId) return;
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(120),
      notes: z.string().max(10000).default(""),
      mediaId: z.number().int().positive().nullable().optional(),
      individualInitiative: z.boolean().default(false)
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give the encounter a name and valid settings." });
  const context = roomSystem(req.account!.id, roomId)!;
  if (parsed.data.individualInitiative && !systems[context.system].initiative.allowIndividualVariant)
    return res.status(400).json({ error: "Individual initiative is not available for this system." });
  const media = validateMedia(roomId, parsed.data.mediaId);
  if ("error" in media) return res.status(400).json({ error: media.error });
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = db
      .prepare(
        `INSERT INTO encounters (room_id, name, media_id, notes, individual_initiative, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        roomId,
        parsed.data.name,
        parsed.data.mediaId ?? null,
        parsed.data.notes,
        parsed.data.individualInitiative ? 1 : 0,
        req.account!.id
      );
    const id = Number(result.lastInsertRowid);
    for (const side of sidesFor(context.system))
      db.prepare("INSERT INTO encounter_sides (encounter_id, side) VALUES (?, ?)").run(id, side.id);
    db.exec("COMMIT");
    broadcastRoom(roomId, { type: "encounters-updated" });
    res.status(201).json({ encounter: visibleEncounter(req.account!.id, roomId, id) });
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
});

encounterRouter.patch("/rooms/:roomId/encounters/:encounterId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = gmRoom(req, res);
  if (!roomId) return;
  const existing = encounterForGm(req.account!.id, roomId, Number(req.params.encounterId));
  if (!existing) return res.status(404).json({ error: "Encounter not found." });
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      notes: z.string().max(10000).optional(),
      mediaId: z.number().int().positive().nullable().optional(),
      display: z.enum(["map", "zones"]).optional(),
      individualInitiative: z.boolean().optional()
    })
    .refine((value) => Object.keys(value).length > 0)
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid encounter update." });
  if (parsed.data.individualInitiative && !systems[existing.context.system].initiative.allowIndividualVariant)
    return res.status(400).json({ error: "Individual initiative is not available for this system." });
  const media = validateMedia(roomId, parsed.data.mediaId);
  if ("error" in media) return res.status(400).json({ error: media.error });
  db.prepare(
    `UPDATE encounters SET name = COALESCE(?, name), notes = COALESCE(?, notes), media_id = CASE WHEN ? THEN ? ELSE media_id END,
       display = COALESCE(?, display), individual_initiative = COALESCE(?, individual_initiative),
       updated_at = CURRENT_TIMESTAMP WHERE id = ? AND room_id = ?`
  ).run(
    parsed.data.name ?? null,
    parsed.data.notes ?? null,
    parsed.data.mediaId !== undefined ? 1 : 0,
    parsed.data.mediaId ?? null,
    parsed.data.display ?? null,
    parsed.data.individualInitiative === undefined ? null : parsed.data.individualInitiative ? 1 : 0,
    existing.encounter.id,
    roomId
  );
  broadcastRoom(roomId, { type: "encounters-updated" });
  res.json({ encounter: visibleEncounter(req.account!.id, roomId, existing.encounter.id) });
});

encounterRouter.delete("/rooms/:roomId/encounters/:encounterId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = gmRoom(req, res);
  if (!roomId) return;
  const result = db
    .prepare("DELETE FROM encounters WHERE id = ? AND room_id = ?")
    .run(Number(req.params.encounterId), roomId);
  if (!result.changes) return res.status(404).json({ error: "Encounter not found." });
  broadcastRoom(roomId, { type: "encounters-updated" });
  res.status(204).end();
});

encounterRouter.post("/rooms/:roomId/encounters/:encounterId/activate", requireAuth, (req: AuthedRequest, res) => {
  const roomId = gmRoom(req, res);
  if (!roomId) return;
  const existing = encounterForGm(req.account!.id, roomId, Number(req.params.encounterId));
  if (!existing) return res.status(404).json({ error: "Encounter not found." });
  const confirm = z.object({ confirm: z.boolean().default(false) }).safeParse(req.body ?? {}).data?.confirm ?? false;
  const active = one<{ id: number; name: string }>(
    "SELECT id, name FROM encounters WHERE room_id = ? AND active = 1 AND id <> ? LIMIT 1",
    roomId,
    existing.encounter.id
  );
  if (active && !confirm)
    return res.status(409).json({ error: `Another encounter is active: ${active.name}.`, requiresConfirmation: true });
  db.prepare("UPDATE encounters SET active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND room_id = ?").run(
    existing.encounter.id,
    roomId
  );
  broadcastRoom(roomId, { type: "encounters-updated" });
  res.json({ encounter: visibleEncounter(req.account!.id, roomId, existing.encounter.id) });
});

encounterRouter.delete("/rooms/:roomId/encounters/:encounterId/activate", requireAuth, (req: AuthedRequest, res) => {
  const roomId = gmRoom(req, res);
  if (!roomId) return;
  const result = db
    .prepare("UPDATE encounters SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND room_id = ?")
    .run(Number(req.params.encounterId), roomId);
  if (!result.changes) return res.status(404).json({ error: "Encounter not found." });
  broadcastRoom(roomId, { type: "encounters-updated" });
  res.status(204).end();
});

encounterRouter.patch("/rooms/:roomId/encounters/:encounterId/sides/:side", requireAuth, (req: AuthedRequest, res) => {
  const roomId = gmRoom(req, res);
  if (!roomId) return;
  const existing = encounterForGm(req.account!.id, roomId, Number(req.params.encounterId));
  if (!existing) return res.status(404).json({ error: "Encounter not found." });
  const side = String(req.params.side);
  if (existing.context.system && !validSide(existing.context.system, side))
    return res.status(400).json({ error: "Unknown encounter side." });
  if (systems[existing.context.system].initiative.sideOrder !== "roll")
    return res.status(400).json({ error: "This system uses fixed side order." });
  const parsed = z.object({ initiative: z.number().int().nullable() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Initiative must be an integer or null." });
  const result = db
    .prepare("UPDATE encounter_sides SET initiative = ? WHERE encounter_id = ? AND side = ?")
    .run(parsed.data.initiative, existing.encounter.id, side);
  if (!result.changes) return res.status(404).json({ error: "Encounter side not found." });
  broadcastRoom(roomId, { type: "encounters-updated" });
  res.json({ encounter: visibleEncounter(req.account!.id, roomId, existing.encounter.id) });
});

encounterRouter.post("/rooms/:roomId/encounters/:encounterId/zones", requireAuth, (req: AuthedRequest, res) => {
  const roomId = gmRoom(req, res);
  if (!roomId) return;
  const existing = encounterForGm(req.account!.id, roomId, Number(req.params.encounterId));
  if (!existing) return res.status(404).json({ error: "Encounter not found." });
  const parsed = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give the zone a name." });
  // Zones read left to right, so a new one joins the right-hand end.
  const last =
    one<{ last: number | null }>(
      "SELECT MAX(sort_order) AS last FROM encounter_zones WHERE encounter_id = ?",
      existing.encounter.id
    )?.last ?? -1;
  db.prepare("INSERT INTO encounter_zones (encounter_id, name, sort_order) VALUES (?, ?, ?)").run(
    existing.encounter.id,
    parsed.data.name,
    last + 1
  );
  broadcastRoom(roomId, { type: "encounters-updated" });
  res.status(201).json({ encounter: visibleEncounter(req.account!.id, roomId, existing.encounter.id) });
});

/**
 * Lays the zones out again in the order given. The whole board is sent rather
 * than one zone's new place, so the result cannot depend on which order a run of
 * single writes happened to arrive in.
 */
encounterRouter.patch("/rooms/:roomId/encounters/:encounterId/zones", requireAuth, (req: AuthedRequest, res) => {
  const roomId = gmRoom(req, res);
  if (!roomId) return;
  const existing = encounterForGm(req.account!.id, roomId, Number(req.params.encounterId));
  if (!existing) return res.status(404).json({ error: "Encounter not found." });
  const parsed = z.object({ order: z.array(z.number().int().positive()).max(60) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give the zones in the order they should read." });
  const zones = all<{ id: number }>("SELECT id FROM encounter_zones WHERE encounter_id = ?", existing.encounter.id);
  const given = new Set(parsed.data.order);
  if (
    given.size !== parsed.data.order.length ||
    zones.length !== given.size ||
    zones.some((zone) => !given.has(zone.id))
  )
    return res.status(400).json({ error: "Order every zone of this encounter exactly once." });
  const place = db.prepare("UPDATE encounter_zones SET sort_order = ? WHERE id = ? AND encounter_id = ?");
  db.exec("BEGIN IMMEDIATE");
  try {
    parsed.data.order.forEach((id, index) => place.run(index, id, existing.encounter.id));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  broadcastRoom(roomId, { type: "encounters-updated" });
  res.json({ encounter: visibleEncounter(req.account!.id, roomId, existing.encounter.id) });
});

encounterRouter.patch(
  "/rooms/:roomId/encounters/:encounterId/zones/:zoneId",
  requireAuth,
  (req: AuthedRequest, res) => {
    const roomId = gmRoom(req, res);
    if (!roomId) return;
    const existing = encounterForGm(req.account!.id, roomId, Number(req.params.encounterId));
    if (!existing) return res.status(404).json({ error: "Encounter not found." });
    const parsed = z
      .object({ name: z.string().trim().min(1).max(60).optional(), sortOrder: z.number().int().min(0).optional() })
      .refine((value) => Object.keys(value).length > 0)
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid zone update." });
    const result = db
      .prepare(
        "UPDATE encounter_zones SET name = COALESCE(?, name), sort_order = COALESCE(?, sort_order) WHERE id = ? AND encounter_id = ?"
      )
      .run(parsed.data.name ?? null, parsed.data.sortOrder ?? null, Number(req.params.zoneId), existing.encounter.id);
    if (!result.changes) return res.status(404).json({ error: "Zone not found." });
    broadcastRoom(roomId, { type: "encounters-updated" });
    res.json({ encounter: visibleEncounter(req.account!.id, roomId, existing.encounter.id) });
  }
);

encounterRouter.delete(
  "/rooms/:roomId/encounters/:encounterId/zones/:zoneId",
  requireAuth,
  (req: AuthedRequest, res) => {
    const roomId = gmRoom(req, res);
    if (!roomId) return;
    const existing = encounterForGm(req.account!.id, roomId, Number(req.params.encounterId));
    if (!existing) return res.status(404).json({ error: "Encounter not found." });
    // Whoever stood there is not removed from the fight, only from the board.
    const result = db
      .prepare("DELETE FROM encounter_zones WHERE id = ? AND encounter_id = ?")
      .run(Number(req.params.zoneId), existing.encounter.id);
    if (!result.changes) return res.status(404).json({ error: "Zone not found." });
    broadcastRoom(roomId, { type: "encounters-updated" });
    res.json({ encounter: visibleEncounter(req.account!.id, roomId, existing.encounter.id) });
  }
);

encounterRouter.post("/rooms/:roomId/encounters/:encounterId/combatants", requireAuth, (req: AuthedRequest, res) => {
  const roomId = gmRoom(req, res);
  if (!roomId) return;
  const existing = encounterForGm(req.account!.id, roomId, Number(req.params.encounterId));
  if (!existing) return res.status(404).json({ error: "Encounter not found." });
  const parsed = z
    .object({
      kind: z.enum(["character", "hireling", "npc"]),
      characterId: z.number().int().positive().optional(),
      hirelingId: z.string().min(1).max(120).optional(),
      npcId: z.number().int().positive().optional(),
      catalogName: z.string().trim().min(1).max(200).optional(),
      name: z.string().trim().min(1).max(120).optional(),
      side: z.string().min(1).max(40).optional(),
      sortOrder: z.number().int().default(0)
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid combatant." });
  // The side follows the kind unless the GM names one. A blanket "enemies" default
  // would reject every character and hireling add, since neither may sit there.
  const body = { ...parsed.data, side: parsed.data.side ?? (parsed.data.kind === "npc" ? "enemies" : "party") };
  if (!validSide(existing.context.system, body.side)) return res.status(400).json({ error: "Unknown encounter side." });
  if (body.kind === "character" && body.characterId === undefined)
    return res.status(400).json({ error: "Choose a character." });
  if (body.kind === "hireling" && body.hirelingId === undefined)
    return res.status(400).json({ error: "Choose a hireling." });
  if (body.kind === "npc" && body.npcId === undefined && body.catalogName === undefined)
    return res.status(400).json({ error: "Choose an NPC." });

  const groupState = parseGroupState(
    one<{ group_json: string }>("SELECT group_json FROM room_state WHERE room_id = ?", roomId)?.group_json
  );
  let sourceName = body.name ?? "Combatant";
  let characterId: number | null = null;
  let hirelingId: string | null = null;
  let npcId: number | null = null;
  let snapshot: Record<string, unknown> = {};
  let catalogMarkdown: string | undefined;
  if (body.kind === "character") {
    const visible = findVisibleCharacter(req.account!.id, roomId, body.characterId!);
    if (!visible) return res.status(404).json({ error: "Character not found." });
    characterId = body.characterId!;
    sourceName = body.name ?? visible.row.name;
    if (body.side === "enemies") return res.status(400).json({ error: "Characters must be on the party side." });
  } else if (body.kind === "hireling") {
    const hireling = hirelingFromState(groupState, body.hirelingId!);
    if (!hireling) return res.status(404).json({ error: "Hireling not found." });
    hirelingId = body.hirelingId!;
    sourceName = body.name ?? String(hireling.name ?? "Hireling");
    if (body.side === "enemies") return res.status(400).json({ error: "Hirelings must be on the party side." });
  } else {
    if (body.catalogName !== undefined) {
      const entry = npcCatalog(existing.context.system).find((candidate) => candidate.name === body.catalogName);
      if (!entry) return res.status(404).json({ error: "Built-in bestiary entry not found." });
      const parsedNpc = parseNpcStatblock(existing.context.system, entry.markdown);
      catalogMarkdown = entry.markdown;
      sourceName = body.name ?? entry.name;
      snapshot = parsedNpc.fields;
    } else {
      const npc = one<{ id: number; name: string; statblock_json: string }>(
        "SELECT id, name, statblock_json FROM custom_npcs WHERE id = ? AND room_id = ?",
        body.npcId!,
        roomId
      );
      if (!npc) return res.status(404).json({ error: "Custom NPC not found." });
      npcId = npc.id;
      sourceName = body.name ?? npc.name;
      snapshot = statblock(npc.statblock_json);
    }
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    if (catalogMarkdown !== undefined) {
      // One spawned record per bestiary entry per room. Adding a third goblin
      // reuses the record and gets its own combatant, rather than leaving three
      // identical rows behind.
      const existingSpawn = one<{ id: number }>(
        "SELECT id FROM custom_npcs WHERE room_id = ? AND name = ? AND spawned = 1",
        roomId,
        sourceName
      );
      if (existingSpawn) npcId = existingSpawn.id;
      else {
        const result = db
          .prepare(
            "INSERT INTO custom_npcs (room_id, created_by, name, notes, statblock_json, spawned) VALUES (?, ?, ?, ?, ?, 1)"
          )
          .run(roomId, req.account!.id, sourceName, catalogMarkdown, JSON.stringify(snapshot));
        npcId = Number(result.lastInsertRowid);
      }
    }
    const hp = body.kind === "npc" && typeof snapshot.hp === "number" ? Number(snapshot.hp) : null;
    const result = db
      .prepare(
        `INSERT INTO encounter_combatants (encounter_id, kind, character_id, npc_id, hireling_id, name, side, sort_order, hp_current, hp_max, statblock_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        existing.encounter.id,
        body.kind,
        characterId,
        npcId,
        hirelingId,
        sourceName,
        body.side,
        body.sortOrder,
        hp,
        hp,
        JSON.stringify(snapshot)
      );
    const combatantId = Number(result.lastInsertRowid);
    db.exec("COMMIT");
    broadcastRoom(roomId, { type: "encounters-updated" });
    res.status(201).json({ combatantId, encounter: visibleEncounter(req.account!.id, roomId, existing.encounter.id) });
  } catch (error) {
    db.exec("ROLLBACK");
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message))
      return res.status(409).json({ error: "That character or hireling is already in this encounter." });
    throw error;
  }
});

encounterRouter.patch(
  "/rooms/:roomId/encounters/:encounterId/combatants/:combatantId",
  requireAuth,
  (req: AuthedRequest, res) => {
    // The one route on this router a player may reach, and only to spend or heal
    // their own character's hit points from the tracker. Everything else about a
    // combatant belongs to the GM.
    const roomId = Number(req.params.roomId);
    const context = Number.isInteger(roomId) ? roomSystem(req.account!.id, roomId) : undefined;
    if (!context) return res.status(404).json({ error: "Room not found." });
    const encounter = one<EncounterRow>(
      "SELECT * FROM encounters WHERE id = ? AND room_id = ?",
      Number(req.params.encounterId),
      roomId
    );
    if (!encounter || (context.role === "player" && !encounter.active))
      return res.status(404).json({ error: "Encounter not found." });
    const existing = { context, encounter };
    const row = one<CombatantRow>(
      "SELECT * FROM encounter_combatants WHERE id = ? AND encounter_id = ?",
      Number(req.params.combatantId),
      existing.encounter.id
    );
    if (!row) return res.status(404).json({ error: "Combatant not found." });
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        side: z.string().min(1).max(40).optional(),
        initiative: z.number().int().nullable().optional(),
        actsFirstTurn: z.boolean().nullable().optional(),
        sortOrder: z.number().int().optional(),
        included: z.boolean().optional(),
        conditions: z.string().max(2000).optional(),
        hpCurrent: z.number().int().optional(),
        /** Scores spent past 0 HP, keyed by the system's attribute ids. */
        attributes: z.record(z.string(), z.number().int().min(0)).optional(),
        /** Which zone they are standing in, or null for none. */
        zoneId: z.number().int().positive().nullable().optional(),
        /** Monolith's mark for failing the save that follows a spent attribute. */
        criticalDamage: z.boolean().optional()
      })
      .refine((value) => Object.keys(value).length > 0)
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid combatant update." });
    // Whose character it is decides the rest, and `updateCharacter` below settles
    // that with the same rule the sheet itself uses.
    // A player says three things: what their own character has spent, and where
    // their own character or one of the party's hirelings is standing. Ownership
    // is settled here for placement, since nothing further down would check it.
    if (context.role === "player") {
      const keys = Object.keys(parsed.data);
      const ownScores = keys.every(
        (key) => key === "hpCurrent" || key === "attributes" || key === "zoneId" || key === "criticalDamage"
      );
      const placementOnly = keys.length === 1 && keys[0] === "zoneId";
      if (!ownScores || row.kind === "npc" || (row.kind === "hireling" && !placementOnly))
        return res.status(403).json({ error: "Only the room GM can manage encounters." });
      // Someone else's character is not theirs to touch, and is answered the way
      // the sheet answers it: as one they cannot see.
      if (row.kind === "character" && !findAccessibleCharacter(req.account!.id, roomId, row.character_id!))
        return res.status(404).json({ error: "Character not found." });
    }
    if (parsed.data.side !== undefined && !validSide(existing.context.system, parsed.data.side))
      return res.status(400).json({ error: "Unknown encounter side." });
    if (parsed.data.zoneId != null) {
      const zone = one<{ id: number }>(
        "SELECT id FROM encounter_zones WHERE id = ? AND encounter_id = ?",
        parsed.data.zoneId,
        existing.encounter.id
      );
      if (!zone) return res.status(404).json({ error: "Zone not found." });
    }

    // Hit points and attributes travel to the same place, so they are gathered
    // into one patch and written once.
    // Scores are numbers; the one mark a system may carry is a state beside them.
    let scores: Record<string, number | boolean> = {};
    if (parsed.data.attributes) {
      const mapped = attributePatch(existing.context.system, row.kind, parsed.data.attributes);
      if ("error" in mapped) return res.status(400).json({ error: mapped.error });
      scores = mapped.patch;
    }
    if (parsed.data.criticalDamage !== undefined) {
      const mark = systems[existing.context.system].attributeDamage?.criticalDamage;
      if (!mark) return res.status(400).json({ error: "This system does not track critical damage." });
      scores[mark.key] = parsed.data.criticalDamage;
    }
    if (parsed.data.hpCurrent !== undefined && row.kind !== "npc") {
      const keys = hpKeys(existing.context.system, row.kind === "hireling");
      if (!keys.current) return res.status(400).json({ error: `This system has no ${row.kind} HP field.` });
      scores[keys.current] = parsed.data.hpCurrent;
    }
    if (Object.keys(scores).length) {
      if (row.kind === "character") {
        const result = updateCharacter(req.account!.id, roomId, row.character_id!, { sheetPatch: scores });
        if ("error" in result) return res.status(result.status).json({ error: result.error });
      } else if (row.kind === "hireling") {
        const result = updateHireling(roomId, row.hireling_id!, scores);
        if ("error" in result) return res.status(result.status).json({ error: result.error });
      } else {
        // A statblock states one number per score. The first time one is spent,
        // what it was is recorded beside it, so the dialog can show how much of
        // the creature is left rather than only what remains.
        const fields = statblock(row.statblock_json);
        const maxima = Object.fromEntries(
          Object.keys(scores)
            .filter((key) => fields[`${key}Max`] === undefined && typeof fields[key] === "number")
            .map((key) => [`${key}Max`, fields[key]])
        );
        db.prepare("UPDATE encounter_combatants SET statblock_json = ? WHERE id = ?").run(
          JSON.stringify({ ...fields, ...maxima, ...scores }),
          row.id
        );
      }
    }
    const values = parsed.data;
    db.prepare(
      `UPDATE encounter_combatants SET name = COALESCE(?, name), side = COALESCE(?, side), initiative = CASE WHEN ? THEN ? ELSE initiative END,
       acts_first_turn = CASE WHEN ? THEN ? ELSE acts_first_turn END, sort_order = COALESCE(?, sort_order), included = COALESCE(?, included),
       conditions = COALESCE(?, conditions), hp_current = CASE WHEN kind = 'npc' AND ? THEN ? ELSE hp_current END,
       zone_id = CASE WHEN ? THEN ? ELSE zone_id END,
       updated_at = CURRENT_TIMESTAMP WHERE id = ? AND encounter_id = ?`
    ).run(
      values.name ?? null,
      values.side ?? null,
      values.initiative !== undefined ? 1 : 0,
      values.initiative ?? null,
      values.actsFirstTurn !== undefined ? 1 : 0,
      values.actsFirstTurn === null ? null : values.actsFirstTurn ? 1 : 0,
      values.sortOrder ?? null,
      values.included === undefined ? null : values.included ? 1 : 0,
      values.conditions ?? null,
      row.kind === "npc" && values.hpCurrent !== undefined ? 1 : 0,
      values.hpCurrent ?? null,
      values.zoneId !== undefined ? 1 : 0,
      values.zoneId ?? null,
      row.id,
      existing.encounter.id
    );
    broadcastRoom(roomId, { type: "encounters-updated" });
    res.json({ encounter: visibleEncounter(req.account!.id, roomId, existing.encounter.id) });
  }
);

encounterRouter.delete(
  "/rooms/:roomId/encounters/:encounterId/combatants/:combatantId",
  requireAuth,
  (req: AuthedRequest, res) => {
    const roomId = gmRoom(req, res);
    if (!roomId) return;
    const result = db
      .prepare(
        "DELETE FROM encounter_combatants WHERE id = ? AND encounter_id IN (SELECT id FROM encounters WHERE id = ? AND room_id = ?)"
      )
      .run(Number(req.params.combatantId), Number(req.params.encounterId), roomId);
    if (!result.changes) return res.status(404).json({ error: "Combatant not found." });
    broadcastRoom(roomId, { type: "encounters-updated" });
    res.status(204).end();
  }
);

/**
 * Rolls each side's initiative with the die the system declares. The party's
 * modifier is its best DEX modifier, as CWN 2.4.2 asks for; NPCs add nothing.
 */
encounterRouter.post(
  "/rooms/:roomId/encounters/:encounterId/roll-initiative",
  requireAuth,
  (req: AuthedRequest, res) => {
    const roomId = gmRoom(req, res);
    if (!roomId) return;
    const existing = encounterForGm(req.account!.id, roomId, Number(req.params.encounterId));
    if (!existing) return res.status(404).json({ error: "Encounter not found." });
    const rules = systems[existing.context.system].initiative;
    if (rules.sideOrder !== "roll" || !rules.roll)
      return res.status(400).json({ error: "This system does not roll for initiative." });

    const combatants = all<CombatantRow>(
      "SELECT * FROM encounter_combatants WHERE encounter_id = ? AND included = 1",
      existing.encounter.id
    );
    const bestPartyDex = combatants.reduce((best, row) => {
      if (row.kind !== "character" || row.character_id === null) return best;
      const visible = findVisibleCharacter(req.account!.id, roomId, row.character_id);
      const sheet = visible
        ? (publicCharacter(visible.row as CharacterRow, roomId).sheet as Record<string, unknown>)
        : {};
      const modifier = Number(sheet.dexModifier);
      return Number.isFinite(modifier) && modifier > best ? modifier : best;
    }, 0);

    const update = db.prepare("UPDATE encounter_sides SET initiative = ? WHERE encounter_id = ? AND side = ?");
    for (const side of sidesFor(existing.context.system)) {
      const modifier = side.id === "party" && rules.roll.modifierFrom === "best-dex" ? bestPartyDex : 0;
      const expression = `${rules.roll.dice}${modifier ? (modifier > 0 ? `+${modifier}` : String(modifier)) : ""}`;
      update.run(rollDice(expression).total, existing.encounter.id, side.id);
    }
    broadcastRoom(roomId, { type: "encounters-updated" });
    res.json({ encounter: visibleEncounter(req.account!.id, roomId, existing.encounter.id) });
  }
);

encounterRouter.post("/rooms/:roomId/encounters/:encounterId/opening-saves", requireAuth, (req: AuthedRequest, res) => {
  const roomId = gmRoom(req, res);
  if (!roomId) return;
  const existing = encounterForGm(req.account!.id, roomId, Number(req.params.encounterId));
  if (!existing) return res.status(404).json({ error: "Encounter not found." });
  if (!systems[existing.context.system].initiative.entrySave)
    return res.status(400).json({ error: "This system has no opening saves." });
  const parsed = z
    .object({
      results: z.array(z.object({ combatantId: z.number().int().positive(), actsFirstTurn: z.boolean() })).max(200)
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid opening save results." });
  db.prepare("UPDATE encounter_combatants SET acts_first_turn = NULL WHERE encounter_id = ?").run(
    existing.encounter.id
  );
  const update = db.prepare(
    "UPDATE encounter_combatants SET acts_first_turn = ? WHERE id = ? AND encounter_id = ? AND kind IN ('character','hireling')"
  );
  for (const result of parsed.data.results)
    update.run(result.actsFirstTurn ? 1 : 0, result.combatantId, existing.encounter.id);
  broadcastRoom(roomId, { type: "encounters-updated" });
  res.json({ encounter: visibleEncounter(req.account!.id, roomId, existing.encounter.id) });
});

encounterRouter.delete(
  "/rooms/:roomId/encounters/:encounterId/opening-saves",
  requireAuth,
  (req: AuthedRequest, res) => {
    const roomId = gmRoom(req, res);
    if (!roomId) return;
    const encounter = one<{ id: number }>(
      "SELECT id FROM encounters WHERE id = ? AND room_id = ?",
      Number(req.params.encounterId),
      roomId
    );
    if (!encounter) return res.status(404).json({ error: "Encounter not found." });
    db.prepare("UPDATE encounter_combatants SET acts_first_turn = NULL WHERE encounter_id = ?").run(encounter.id);
    broadcastRoom(roomId, { type: "encounters-updated" });
    res.status(204).end();
  }
);
