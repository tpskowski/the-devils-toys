import express from "express";
import { z } from "zod";
import {
  rollTableLabel,
  TABLE_ROLL_VISIBILITIES,
  type TableRollResult,
  type TableRollVisibility,
  type SystemId
} from "@devils-toys/shared";
import type { AuthedRequest } from "./auth.js";
import { requireAuth, roomRole } from "./auth.js";
import { db, one } from "./db.js";
import { availableSets, findSet } from "./table-sets.js";
import { rollDice } from "./dice.js";
import { inGameDisplayName } from "./display-name.js";
import { rowForRoll, rowText } from "./roll-tables.js";
import { broadcastRoom, sendToRoomGms, sendToRoomPlayers } from "./realtime.js";

/** Browsing and rolling on the catalogue from inside a room, for the room's GM. */
export const tableRouter = express.Router();
export const DEFAULT_TABLE_ROLL_NOTICE = "Rolled on a random table";

function gmRoom(req: AuthedRequest, res: express.Response) {
  const roomId = Number(req.params.roomId);
  if (!Number.isInteger(roomId) || roomRole(req.account!.id, roomId) !== "gm") {
    res.status(403).json({ error: "Random tables are reserved for the room GM." });
    return;
  }
  return roomId;
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
  return message;
}

function privateTableMessage(
  roomId: number,
  accountId: number,
  label: string,
  rolled: { total: number; detail: string },
  resultText: string,
  visibility: "private" | "invisible"
) {
  const stored = db
    .prepare("INSERT INTO private_rolls (room_id, account_id, expression, result) VALUES (?, ?, ?, ?)")
    .run(
      roomId,
      accountId,
      label,
      JSON.stringify({
        ...rolled,
        detail: [rolled.detail, resultText].filter(Boolean).join(" · "),
        visibility
      })
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
  const result = JSON.parse(privateRow.result) as {
    total: number;
    detail?: string;
    visibility?: "private" | "invisible";
  };
  return {
    id: privateRow.id,
    roomId: privateRow.room_id,
    accountId: privateRow.account_id,
    username: privateRow.username,
    displayName: inGameDisplayName(privateRow.username, privateRow.character_name),
    kind: "roll" as const,
    body: `${privateRow.expression} → ${result.total}`,
    detail: result.detail,
    private: true,
    rollVisibility: result.visibility ?? "private",
    createdAt: privateRow.created_at
  };
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
  // Where the table sits in its Markdown is the editor's business, not the roller's.
  const { source, ...rest } = table;
  res.json({ table: rest });
});

tableRouter.post("/rooms/:roomId/tables/roll", requireAuth, (req: AuthedRequest, res) => {
  const roomId = gmRoom(req, res);
  if (!roomId) return;
  const parsed = z
    .object({
      setId: z.string().min(1).max(80),
      tableId: z.string().min(1).max(200),
      modifier: z.number().int().min(-100).max(100).default(0),
      visibility: z.enum(TABLE_ROLL_VISIBILITIES).default("public")
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a table and how the roll is shared." });
  const found = findSet(parsed.data.setId);
  const table = found?.tables.find((entry) => entry.id === parsed.data.tableId);
  if (!found || !table) return res.status(404).json({ error: "Table not found." });

  const rolled = rollDice(
    `${table.dice}${parsed.data.modifier ? `${parsed.data.modifier > 0 ? "+" : ""}${parsed.data.modifier}` : ""}`
  );
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
    const message = privateTableMessage(roomId, req.account!.id, label, rolled, missing || text, "private");
    const notice = publicTableMessage(roomId, req.account!.id, DEFAULT_TABLE_ROLL_NOTICE, null);
    sendToRoomGms(roomId, { type: "message", message });
    sendToRoomPlayers(roomId, { type: "message", message: notice });
    return res.status(201).json({ roll, message, private: true });
  }
  if (visibility === "reveal") {
    const message = publicTableMessage(roomId, req.account!.id, headline, missing || text || rolled.detail);
    broadcastRoom(roomId, { type: "message", message });
    return res.status(201).json({ roll, message });
  }

  // Private and invisible rolls stay in the GM's own log; only a private roll
  // tells the room that something was rolled.
  const message = privateTableMessage(roomId, req.account!.id, label, rolled, missing || text, visibility);
  if (visibility === "private") {
    const notice = publicTableMessage(roomId, req.account!.id, `Rolled privately on ${table.name}`, null);
    broadcastRoom(roomId, { type: "message", message: notice });
  }
  res.status(201).json({ roll, message, private: true });
});
