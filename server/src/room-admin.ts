import fs from "node:fs";
import path from "node:path";
import express from "express";
import { z } from "zod";
import type { AuthedRequest } from "./auth.js";
import { requireAuth, roomRole } from "./auth.js";
import { all, db, one } from "./db.js";
import { config } from "./config.js";
import { refreshRoomAccess } from "./realtime.js";

export const roomAdminRouter = express.Router();

function requireRoomGm(req: AuthedRequest, res: express.Response) {
  const roomId = Number(req.params.roomId);
  if (!Number.isInteger(roomId) || roomRole(req.account!.id, roomId) !== "gm") {
    res.status(403).json({ error: "Only the room GM can manage players." });
    return;
  }
  return roomId;
}

roomAdminRouter.get("/rooms/:roomId/member-options", requireAuth, (req: AuthedRequest, res: express.Response) => {
  const roomId = requireRoomGm(req, res);
  if (!roomId) return;
  const accounts = all<{ id: number; username: string }>(
    `SELECT a.id, a.username FROM accounts a
       WHERE (? = 1 OR a.account_role = 'player')
       AND NOT EXISTS (
         SELECT 1 FROM memberships m WHERE m.room_id = ? AND m.account_id = a.id
       ) AND NOT EXISTS (
         SELECT 1 FROM invitations i
         WHERE i.account_id = a.id AND i.redeemed_at IS NULL AND i.revoked_at IS NULL
           AND i.expires_at > CURRENT_TIMESTAMP
       )
       ORDER BY a.username`,
    req.account!.isAdmin ? 1 : 0,
    roomId
  );
  res.json({ accounts });
});

roomAdminRouter.post("/rooms/:roomId/members", requireAuth, (req: AuthedRequest, res: express.Response) => {
  const roomId = requireRoomGm(req, res);
  if (!roomId) return;
  const parsed = z.object({ accountId: z.number().int().positive() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a valid player account." });
  const account = one<{ id: number; username: string; account_role: "admin" | "gm" | "player" }>(
    "SELECT id, username, account_role FROM accounts WHERE id = ?",
    parsed.data.accountId
  );
  if (!account) return res.status(404).json({ error: "Account not found." });
  if (!req.account!.isAdmin && account.account_role !== "player")
    return res.status(403).json({ error: "GMs can only add player-level accounts." });
  try {
    db.prepare("INSERT INTO memberships (room_id, account_id, role) VALUES (?, ?, 'player')").run(roomId, account.id);
  } catch (error) {
    if (String(error).includes("UNIQUE")) return res.status(409).json({ error: "That account is already a member." });
    throw error;
  }
  refreshRoomAccess(roomId);
  res.status(201).json({ member: { accountId: account.id, username: account.username, role: "player" } });
});

roomAdminRouter.delete(
  "/rooms/:roomId/members/:accountId",
  requireAuth,
  (req: AuthedRequest, res: express.Response) => {
    const roomId = requireRoomGm(req, res);
    if (!roomId) return;
    const accountId = Number(req.params.accountId);
    const result = db
      .prepare("DELETE FROM memberships WHERE room_id = ? AND account_id = ? AND role = 'player'")
      .run(roomId, accountId);
    if (!result.changes) return res.status(404).json({ error: "Player membership not found." });
    refreshRoomAccess(roomId);
    res.status(204).end();
  }
);

roomAdminRouter.delete("/rooms/:roomId", requireAuth, (req: AuthedRequest, res: express.Response) => {
  if (!req.account!.isAdmin) return res.status(403).json({ error: "Server admin access required." });
  const roomId = Number(req.params.roomId);
  const room = one<{ id: number }>("SELECT id FROM rooms WHERE id = ?", roomId);
  if (!room) return res.status(404).json({ error: "Room not found." });
  const storedNames = all<{ stored_name: string }>("SELECT stored_name FROM media WHERE room_id = ?", roomId);
  db.prepare("DELETE FROM rooms WHERE id = ?").run(roomId);
  refreshRoomAccess(roomId);
  const uploadsDir = path.join(config.dataDir, "uploads");
  for (const media of storedNames) {
    if (path.basename(media.stored_name) !== media.stored_name) continue;
    try {
      fs.rmSync(path.join(uploadsDir, media.stored_name), { force: true });
    } catch {
      // The database deletion remains authoritative if an already-missing file cannot be removed.
    }
  }
  res.status(204).end();
});
