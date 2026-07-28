import crypto from "node:crypto";
import express from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { AuthedRequest } from "./auth.js";
import { createSession, requireAuth, roomRole } from "./auth.js";
import { all, db, one } from "./db.js";
import { invitationStatus, invitationTokenHash } from "./invitation-utils.js";

export const invitationRouter = express.Router();

function requestBody<T>(schema: z.ZodType<T>, input: unknown, res: express.Response): T | undefined {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
    return;
  }
  return parsed.data;
}

invitationRouter.get("/rooms/:roomId/invitations", requireAuth, (req: AuthedRequest, res: express.Response) => {
  const roomId = Number(req.params.roomId);
  if (roomRole(req.account!.id, roomId) !== "gm") {
    return res.status(403).json({ error: "Only the room GM can manage invitations." });
  }
  const invitations = all<{
    id: number;
    username: string;
    expires_at: string;
    redeemed_at: string | null;
    revoked_at: string | null;
  }>(
    `SELECT i.id, a.username, i.expires_at, i.redeemed_at, i.revoked_at
       FROM invitations i JOIN accounts a ON a.id = i.account_id
       WHERE i.room_id = ? ORDER BY i.id DESC`,
    roomId
  ).map((invite) => ({
    id: invite.id,
    username: invite.username,
    expiresAt: invite.expires_at,
    status: invitationStatus(invite)
  }));
  res.json({ invitations });
});

invitationRouter.post(
  "/rooms/:roomId/invitations",
  requireAuth,
  async (req: AuthedRequest, res: express.Response, next: express.NextFunction) => {
    try {
      const roomId = Number(req.params.roomId);
      if (roomRole(req.account!.id, roomId) !== "gm") {
        return res.status(403).json({ error: "Only the room GM can create invitations." });
      }
      const body = requestBody(
        z.object({
          username: z
            .string()
            .trim()
            .min(2)
            .max(32)
            .regex(/^[a-zA-Z0-9._-]+$/, "Use letters, numbers, dots, dashes, or underscores.")
        }),
        req.body,
        res
      );
      if (!body) return;
      if (one("SELECT id FROM accounts WHERE username = ?", body.username)) {
        return res.status(409).json({ error: "That username is already in use." });
      }

      const token = crypto.randomBytes(32).toString("base64url");
      const tokenHash = invitationTokenHash(token);
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const placeholderHash = await bcrypt.hash(crypto.randomBytes(32).toString("base64url"), 12);
      db.exec("BEGIN IMMEDIATE");
      try {
        const account = db
          .prepare("INSERT INTO accounts (username, password_hash, created_by) VALUES (?, ?, ?)")
          .run(body.username, placeholderHash, req.account!.id);
        const invitation = db
          .prepare("INSERT INTO invitations (token_hash, room_id, account_id, expires_at) VALUES (?, ?, ?, ?)")
          .run(tokenHash, roomId, Number(account.lastInsertRowid), expiresAt);
        db.exec("COMMIT");
        res.status(201).json({
          invitation: {
            id: Number(invitation.lastInsertRowid),
            username: body.username,
            token,
            expiresAt,
            status: "pending"
          }
        });
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } catch (error) {
      next(error);
    }
  }
);

invitationRouter.delete(
  "/rooms/:roomId/invitations/:invitationId",
  requireAuth,
  (req: AuthedRequest, res: express.Response) => {
    const roomId = Number(req.params.roomId);
    if (roomRole(req.account!.id, roomId) !== "gm") {
      return res.status(403).json({ error: "Only the room GM can revoke invitations." });
    }
    const result = db
      .prepare(
        `UPDATE invitations SET revoked_at = CURRENT_TIMESTAMP
         WHERE id = ? AND room_id = ? AND redeemed_at IS NULL AND revoked_at IS NULL`
      )
      .run(Number(req.params.invitationId), roomId);
    if (!result.changes) return res.status(404).json({ error: "Pending invitation not found." });
    res.status(204).end();
  }
);

invitationRouter.get("/invitations/:token", (req, res) => {
  const tokenHash = invitationTokenHash(String(req.params.token));
  const invitation = one<{
    username: string;
    room_name: string;
    system: string;
    expires_at: string;
    redeemed_at: string | null;
    revoked_at: string | null;
  }>(
    `SELECT a.username, r.name AS room_name, r.system, i.expires_at, i.redeemed_at, i.revoked_at
     FROM invitations i JOIN accounts a ON a.id = i.account_id JOIN rooms r ON r.id = i.room_id
     WHERE i.token_hash = ?`,
    tokenHash
  );
  if (!invitation) return res.status(404).json({ error: "Invitation not found." });
  res.json({
    invitation: {
      username: invitation.username,
      roomName: invitation.room_name,
      system: invitation.system,
      expiresAt: invitation.expires_at,
      status: invitationStatus(invitation)
    }
  });
});

invitationRouter.post(
  "/invitations/:token/redeem",
  async (req: AuthedRequest, res: express.Response, next: express.NextFunction) => {
    try {
      const body = requestBody(z.object({ password: z.string().min(8).max(128) }), req.body, res);
      if (!body) return;
      const tokenHash = invitationTokenHash(String(req.params.token));
      const invitation = one<{ id: number; room_id: number; account_id: number; username: string }>(
        `SELECT i.id, i.room_id, i.account_id, a.username FROM invitations i
         JOIN accounts a ON a.id = i.account_id
         WHERE i.token_hash = ? AND i.redeemed_at IS NULL AND i.revoked_at IS NULL
         AND i.expires_at > CURRENT_TIMESTAMP`,
        tokenHash
      );
      if (!invitation) return res.status(410).json({ error: "This invitation is no longer valid." });
      const passwordHash = await bcrypt.hash(body.password, 12);
      db.exec("BEGIN IMMEDIATE");
      try {
        const claimed = db
          .prepare(
            `UPDATE invitations SET redeemed_at = CURRENT_TIMESTAMP
             WHERE id = ? AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP`
          )
          .run(invitation.id);
        if (!claimed.changes) {
          db.exec("ROLLBACK");
          return res.status(410).json({ error: "This invitation is no longer valid." });
        }
        db.prepare("UPDATE accounts SET password_hash = ? WHERE id = ?").run(passwordHash, invitation.account_id);
        db.prepare("INSERT INTO memberships (room_id, account_id, role) VALUES (?, ?, 'player')").run(
          invitation.room_id,
          invitation.account_id
        );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      createSession(res, invitation.account_id);
      res.json({
        account: { id: invitation.account_id, username: invitation.username, isAdmin: false, role: "player" }
      });
    } catch (error) {
      next(error);
    }
  }
);
