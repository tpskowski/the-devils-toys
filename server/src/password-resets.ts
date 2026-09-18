import crypto from "node:crypto";
import express from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db, one } from "./db.js";
import { clearSession } from "./auth.js";
import { asyncRoute, parse } from "./session-routes.js";
import { disconnectAccount } from "./realtime.js";

const digest = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const unavailable = "This password reset link is invalid or expired. Ask for a new link.";

export function createPasswordReset(accountId: number) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  // Binding to the current hash invalidates links after any password change,
  // including a reset through the CLI. Reissuing replaces the previous link.
  db.prepare(
    `INSERT INTO password_resets (account_id, token_hash, password_hash, expires_at)
    SELECT id, ?, password_hash, ? FROM accounts WHERE id = ?
    ON CONFLICT(account_id) DO UPDATE SET token_hash = excluded.token_hash,
      password_hash = excluded.password_hash, expires_at = excluded.expires_at`
  ).run(digest(token), expiresAt, accountId);
  return { token, expiresAt };
}

function pendingReset(token: string) {
  return one<{ account_id: number; username: string }>(
    `SELECT r.account_id, a.username FROM password_resets r
     JOIN accounts a ON a.id = r.account_id AND a.password_hash = r.password_hash
     WHERE r.token_hash = ? AND julianday(r.expires_at) > julianday('now')`,
    digest(token)
  );
}

export const passwordResetRouter = express.Router();
passwordResetRouter.use("/password-reset", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

passwordResetRouter.post(
  "/password-reset/open",
  asyncRoute((req, res) => {
    // Opening even an expired link leaves this browser signed out.
    clearSession(req, res);
    const body = parse(z.object({ token: tokenSchema }), req.body, res);
    if (!body) return;
    const reset = pendingReset(body.token);
    if (!reset) return res.status(400).json({ error: unavailable });
    res.json({ username: reset.username });
  })
);

passwordResetRouter.post(
  "/password-reset",
  asyncRoute(async (req, res) => {
    clearSession(req, res);
    const body = parse(
      z.object({
        token: tokenSchema,
        password: z.string().min(14, "Passwords must contain at least 14 characters.").max(128)
      }),
      req.body,
      res
    );
    if (!body) return;
    if (!pendingReset(body.token)) return res.status(400).json({ error: unavailable });
    const hash = await bcrypt.hash(body.password, 12);
    db.exec("BEGIN IMMEDIATE");
    let accountId: number;
    try {
      // Recheck after hashing: a concurrent request may redeem or replace it.
      const reset = pendingReset(body.token);
      if (!reset) {
        db.exec("ROLLBACK");
        return res.status(400).json({ error: unavailable });
      }
      accountId = reset.account_id;
      db.prepare("UPDATE accounts SET password_hash = ? WHERE id = ?").run(hash, accountId);
      db.prepare("DELETE FROM password_resets WHERE account_id = ?").run(accountId);
      db.prepare("DELETE FROM sessions WHERE account_id = ?").run(accountId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    disconnectAccount(accountId);
    res.status(204).end();
  })
);
