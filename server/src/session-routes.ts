import express from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { THEME_IDS, type AccountRole } from "@devils-toys/shared";
import type { AuthedRequest } from "./auth.js";
import { clearSession, createSession, requireAuth } from "./auth.js";
import { db, one } from "./db.js";
import { allSystems, systemOrThrow } from "./systems.js";
import { offeredSystemIds } from "./system-registry.js";
import { disconnectSession } from "./realtime.js";

const offeredSystems = () => offeredSystemIds().map(systemOrThrow);
import { itemTraitsFor } from "./character-items.js";

/**
 * Signing in, signing out, and asking who you are. These live apart from the
 * game server because The Devil's Tables runs as its own process and needs
 * exactly these routes and nothing else. Both processes serve them from the same
 * host, so the session cookie — which is scoped by host rather than by port —
 * is shared: signing in to either signs you in to both.
 */
export const sessionRouter = express.Router();

export const asyncRoute =
  (handler: (req: AuthedRequest, res: express.Response) => Promise<unknown> | unknown) =>
  async (req: AuthedRequest, res: express.Response, next: express.NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };

export function parse<T>(schema: z.ZodType<T>, input: unknown, res: express.Response): T | undefined {
  const result = schema.safeParse(input);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0]?.message ?? "Invalid request." });
    return;
  }
  return result.data;
}

export function publicAccount(row: { id: number; username: string; is_admin: number; account_role: AccountRole }) {
  return { id: row.id, username: row.username, isAdmin: Boolean(row.is_admin), role: row.account_role };
}

const systemStatus = ({
  id,
  name,
  shortName,
  glyph,
  tagline,
  defaultTheme,
  rollRulesQuery,
  dice,
  groupPage,
  optionalRules
}: ReturnType<typeof systemOrThrow>) => ({
  id,
  name,
  shortName,
  glyph,
  tagline,
  defaultTheme,
  rollRulesQuery,
  dice,
  groupPage: Boolean(groupPage),
  // What the system offers rather than imposes. A room's own settings come
  // with the room; these are the labels a switch needs to be drawn with.
  optionalRules: optionalRules ?? [],
  // What this system's weapon words mean, so anything that shows one can
  // say so rather than repeating the word back.
  traits: itemTraitsFor(id)
});

sessionRouter.get("/status", (_req, res) => {
  const count = one<{ count: number }>("SELECT COUNT(*) AS count FROM accounts")?.count ?? 0;
  res.json({
    initialized: count > 0,
    // Only what a new room may be made on. A retired system keeps its rooms
    // working, but nothing offers to start another on it.
    systems: offeredSystems().map(systemStatus),
    // Existing rooms still need the metadata of retired systems.
    roomSystems: allSystems().map(systemStatus),
    themes: THEME_IDS
  });
});

sessionRouter.post(
  "/login",
  asyncRoute(async (req, res) => {
    const body = parse(z.object({ username: z.string().trim().min(1), password: z.string().min(1) }), req.body, res);
    if (!body) return;
    const account = one<{
      id: number;
      username: string;
      password_hash: string;
      is_admin: number;
      account_role: AccountRole;
    }>("SELECT id, username, password_hash, is_admin, account_role FROM accounts WHERE username = ?", body.username);
    if (!account || !(await bcrypt.compare(body.password, account.password_hash)))
      return res.status(401).json({ error: "Username or password is incorrect." });
    // Password verification yields. A reset may have revoked every session in
    // the meantime, so only issue a session if the verified hash is still current.
    // The transaction also covers resets made by the other server or the CLI.
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = one<typeof account>(
        "SELECT id, username, password_hash, is_admin, account_role FROM accounts WHERE id = ? AND password_hash = ?",
        account.id,
        account.password_hash
      );
      if (!current) {
        db.exec("ROLLBACK");
        return res.status(401).json({ error: "Username or password is incorrect." });
      }
      createSession(res, current.id);
      db.exec("COMMIT");
      res.json({ account: publicAccount(current) });
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  })
);

sessionRouter.post("/logout", (req: AuthedRequest, res) => {
  disconnectSession(clearSession(req, res));
  res.status(204).end();
});

sessionRouter.get("/me", requireAuth, (req: AuthedRequest, res) => res.json({ account: req.account }));
