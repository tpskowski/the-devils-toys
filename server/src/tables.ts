import fs from "node:fs";
import express from "express";
import { z } from "zod";
import {
  rollTableLabel,
  TABLE_ROLL_VISIBILITIES,
  type RollTable,
  type RollTableSet,
  type SystemId,
  type TableRollResult,
  type TableRollVisibility
} from "@devils-toys/shared";
import type { AuthedRequest } from "./auth.js";
import { requireAuth, roomRole } from "./auth.js";
import { all, db, one } from "./db.js";
import { rollDice } from "./dice.js";
import { inGameDisplayName } from "./display-name.js";
import { parseRollTables, rowForRoll, rowText, tableSummary } from "./roll-tables.js";
import { broadcastRoom } from "./realtime.js";
import { projectFile } from "./paths.js";
import { systems } from "./systems.js";

export const tableRouter = express.Router();

interface TableSetRow {
  id: number;
  name: string;
  markdown: string;
  updated_at: string;
}

/** Parsed system tables, kept because the raw Markdown cannot change at runtime. */
const systemTables = new Map<SystemId, RollTable[]>();

function tablesForSystem(system: SystemId) {
  const cached = systemTables.get(system);
  if (cached) return cached;
  const filename = system === "cairn" ? "Cairn.md" : "Monolith.md";
  const parsed = parseRollTables(
    fs.readFileSync(projectFile("raw", filename), "utf8"),
    systems[system].tableCatalog.exclude
  );
  systemTables.set(system, parsed);
  return parsed;
}

function customSets() {
  return all<TableSetRow>("SELECT id, name, markdown, updated_at FROM table_sets ORDER BY name");
}

/** Every set a GM can switch between: one per installed system, then custom sets. */
function availableSets(): { set: RollTableSet; tables: RollTable[] }[] {
  const system = Object.values(systems).map((entry) => {
    const tables = tablesForSystem(entry.id);
    return {
      set: {
        id: `system:${entry.id}`,
        name: entry.tableCatalog.label,
        origin: "system" as const,
        tables: tables.map(tableSummary)
      },
      tables
    };
  });
  const custom = customSets().map((row) => {
    const tables = parseRollTables(row.markdown);
    return {
      set: {
        id: `custom:${row.id}`,
        name: row.name,
        origin: "custom" as const,
        tables: tables.map(tableSummary)
      },
      tables
    };
  });
  return [...system, ...custom];
}

function findSet(setId: string) {
  return availableSets().find((entry) => entry.set.id === setId);
}

function gmRoom(req: AuthedRequest, res: express.Response) {
  const roomId = Number(req.params.roomId);
  if (!Number.isInteger(roomId) || roomRole(req.account!.id, roomId) !== "gm") {
    res.status(403).json({ error: "Random tables are reserved for the room GM." });
    return;
  }
  return roomId;
}

function canManageSets(req: AuthedRequest, res: express.Response) {
  if (req.account!.role === "player") {
    res.status(403).json({ error: "Only a GM can manage table sets." });
    return false;
  }
  return true;
}

function rolledMessage(id: number) {
  return one<{
    id: number;
    room_id: number;
    account_id: number;
    username: string;
    character_name: string | null;
    kind: "chat" | "roll" | "system";
    body: string;
    detail: string | null;
    created_at: string;
  }>(
    `SELECT m.id, m.room_id, m.account_id, a.username, c.name AS character_name,
            m.kind, m.body, m.detail, m.created_at
     FROM messages m JOIN accounts a ON a.id = m.account_id
     LEFT JOIN memberships rm ON rm.room_id = m.room_id AND rm.account_id = m.account_id
     LEFT JOIN characters c ON c.id = rm.active_character_id
     WHERE m.id = ?`,
    id
  )!;
}

function publicTableMessage(roomId: number, accountId: number, body: string, detail: string | null) {
  const result = db
    .prepare("INSERT INTO messages (room_id, account_id, kind, body, detail) VALUES (?, ?, 'roll', ?, ?)")
    .run(roomId, accountId, body, detail);
  const row = rolledMessage(Number(result.lastInsertRowid));
  const message = {
    id: row.id,
    roomId: row.room_id,
    accountId: row.account_id,
    username: row.username,
    displayName: inGameDisplayName(row.username, row.character_name),
    kind: row.kind,
    body: row.body,
    detail: row.detail ?? undefined,
    createdAt: row.created_at
  };
  broadcastRoom(roomId, { type: "message", message });
  return message;
}

tableRouter.get("/rooms/:roomId/tables", requireAuth, (req: AuthedRequest, res) => {
  const roomId = gmRoom(req, res);
  if (!roomId) return;
  const system = one<{ system: SystemId }>("SELECT system FROM rooms WHERE id = ?", roomId)!.system;
  res.json({ sets: availableSets().map((entry) => entry.set), roomSetId: `system:${system}` });
});

tableRouter.get("/rooms/:roomId/tables/:setId/:tableId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = gmRoom(req, res);
  if (!roomId) return;
  const found = findSet(String(req.params.setId));
  const table = found?.tables.find((entry) => entry.id === req.params.tableId);
  if (!table) return res.status(404).json({ error: "Table not found." });
  res.json({ table });
});

tableRouter.post("/rooms/:roomId/tables/roll", requireAuth, (req: AuthedRequest, res) => {
  const roomId = gmRoom(req, res);
  if (!roomId) return;
  const parsed = z
    .object({
      setId: z.string().min(1).max(80),
      tableId: z.string().min(1).max(200),
      visibility: z.enum(TABLE_ROLL_VISIBILITIES).default("public")
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a table and how the roll is shared." });
  const found = findSet(parsed.data.setId);
  const table = found?.tables.find((entry) => entry.id === parsed.data.tableId);
  if (!found || !table) return res.status(404).json({ error: "Table not found." });

  const rolled = rollDice(table.dice);
  const row = rowForRoll(table, rolled.total);
  const text = rowText(table, row);
  const visibility: TableRollVisibility = parsed.data.visibility;
  const roll: TableRollResult = {
    setId: found.set.id,
    setName: found.set.name,
    tableId: table.id,
    tableName: table.name,
    dice: table.dice,
    total: rolled.total,
    detail: rolled.detail,
    row,
    text,
    visibility
  };
  const label = rollTableLabel(table.name, table.dice);
  const headline = `${label} → ${rolled.total}`;
  const missing = row ? "" : `No entry for ${rolled.total}`;

  if (visibility === "public") {
    const message = publicTableMessage(roomId, req.account!.id, headline, missing || rolled.detail);
    return res.status(201).json({ roll, message });
  }
  if (visibility === "reveal") {
    const message = publicTableMessage(roomId, req.account!.id, headline, missing || text || rolled.detail);
    return res.status(201).json({ roll, message });
  }

  // Private and invisible rolls stay in the GM's own log; only a private roll
  // tells the room that something was rolled.
  const stored = db
    .prepare("INSERT INTO private_rolls (room_id, account_id, expression, result) VALUES (?, ?, ?, ?)")
    .run(
      roomId,
      req.account!.id,
      label,
      JSON.stringify({ ...rolled, detail: [rolled.detail, missing || text].filter(Boolean).join(" · ") })
    );
  const privateRow = one<{
    id: number;
    room_id: number;
    account_id: number;
    username: string;
    character_name: string | null;
    expression: string;
    result: string;
    created_at: string;
  }>(
    `SELECT pr.id, pr.room_id, pr.account_id, a.username, c.name AS character_name,
            pr.expression, pr.result, pr.created_at
     FROM private_rolls pr JOIN accounts a ON a.id = pr.account_id
     LEFT JOIN memberships rm ON rm.room_id = pr.room_id AND rm.account_id = pr.account_id
     LEFT JOIN characters c ON c.id = rm.active_character_id
     WHERE pr.id = ?`,
    Number(stored.lastInsertRowid)
  )!;
  const result = JSON.parse(privateRow.result) as { total: number; detail?: string };
  const message = {
    id: privateRow.id,
    roomId: privateRow.room_id,
    accountId: privateRow.account_id,
    username: privateRow.username,
    displayName: inGameDisplayName(privateRow.username, privateRow.character_name),
    kind: "roll" as const,
    body: `${privateRow.expression} → ${result.total}`,
    detail: result.detail,
    private: true,
    createdAt: privateRow.created_at
  };
  if (visibility === "private") publicTableMessage(roomId, req.account!.id, `Rolled privately on ${table.name}`, null);
  res.status(201).json({ roll, message, private: true });
});

tableRouter.get("/table-sets/:setId", requireAuth, (req: AuthedRequest, res) => {
  if (!canManageSets(req, res)) return;
  const row = one<TableSetRow>(
    "SELECT id, name, markdown, updated_at FROM table_sets WHERE id = ?",
    Number(req.params.setId)
  );
  if (!row) return res.status(404).json({ error: "Table set not found." });
  res.json({ set: { id: row.id, name: row.name, markdown: row.markdown, updatedAt: row.updated_at } });
});

const setBody = z.object({
  name: z.string().trim().min(2).max(80),
  markdown: z.string().max(200_000)
});

tableRouter.post("/table-sets", requireAuth, (req: AuthedRequest, res) => {
  if (!canManageSets(req, res)) return;
  const parsed = setBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give the set a name and valid Markdown tables." });
  const result = db
    .prepare("INSERT INTO table_sets (name, markdown, created_by) VALUES (?, ?, ?)")
    .run(parsed.data.name, parsed.data.markdown, req.account!.id);
  const id = Number(result.lastInsertRowid);
  res.status(201).json({ set: { id: `custom:${id}`, tables: parseRollTables(parsed.data.markdown).length } });
});

tableRouter.patch("/table-sets/:setId", requireAuth, (req: AuthedRequest, res) => {
  if (!canManageSets(req, res)) return;
  const parsed = setBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give the set a name and valid Markdown tables." });
  const result = db
    .prepare("UPDATE table_sets SET name = ?, markdown = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(parsed.data.name, parsed.data.markdown, Number(req.params.setId));
  if (!result.changes) return res.status(404).json({ error: "Table set not found." });
  res.status(204).end();
});

tableRouter.delete("/table-sets/:setId", requireAuth, (req: AuthedRequest, res) => {
  if (!canManageSets(req, res)) return;
  const result = db.prepare("DELETE FROM table_sets WHERE id = ?").run(Number(req.params.setId));
  if (!result.changes) return res.status(404).json({ error: "Table set not found." });
  res.status(204).end();
});
