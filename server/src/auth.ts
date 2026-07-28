import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { AccountRole } from "@devils-toys/shared";
import { one, db } from "./db.js";

export interface AuthAccount {
  id: number;
  username: string;
  isAdmin: boolean;
  role: AccountRole;
}

export type AuthedRequest = Request & { account?: AuthAccount };

const sessionCookie = "devils_session";

export function accountForSession(sessionId?: string): AuthAccount | undefined {
  if (!sessionId) return;
  const row = one<{ id: number; username: string; is_admin: number; account_role: AccountRole }>(
    `SELECT a.id, a.username, a.is_admin, a.account_role FROM sessions s
     JOIN accounts a ON a.id = s.account_id
     WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP`,
    sessionId
  );
  return row && { id: row.id, username: row.username, isAdmin: Boolean(row.is_admin), role: row.account_role };
}

export function authMiddleware(req: AuthedRequest, _res: Response, next: NextFunction) {
  req.account = accountForSession(req.cookies?.[sessionCookie]);
  next();
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.account) return res.status(401).json({ error: "Sign in required." });
  next();
}

export function createSession(res: Response, accountId: number) {
  const id = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  db.prepare("INSERT INTO sessions (id, account_id, expires_at) VALUES (?, ?, ?)").run(
    id,
    accountId,
    expires.toISOString()
  );
  res.cookie(sessionCookie, id, { httpOnly: true, sameSite: "strict", secure: false, expires, path: "/" });
}

export function clearSession(req: AuthedRequest, res: Response) {
  const id = req.cookies?.[sessionCookie];
  if (id) db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  res.clearCookie(sessionCookie, { path: "/" });
}

export function roomRole(accountId: number, roomId: number): "gm" | "player" | undefined {
  return one<{ role: "gm" | "player" }>(
    "SELECT role FROM memberships WHERE account_id = ? AND room_id = ?",
    accountId,
    roomId
  )?.role;
}
