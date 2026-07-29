import type express from "express";
import type { AuthedRequest } from "./auth.js";

/**
 * Who may do what to the table catalogue, in one place because both the game
 * server and The Devil's Tables enforce the same three levels:
 *
 * - anyone signed in may read the catalogue,
 * - a GM authors tables for this instance,
 * - an admin also holds the destructive and repo-bound operations, because
 *   re-slugging or deleting a tag rewrites sets a GM never wrote, and a repo
 *   bundle is a change to the application rather than to this instance.
 */

export function requireTableRead(req: AuthedRequest, res: express.Response) {
  if (!req.account) {
    res.status(401).json({ error: "Sign in required." });
    return false;
  }
  return true;
}

export function requireTableEdit(req: AuthedRequest, res: express.Response) {
  if (!requireTableRead(req, res)) return false;
  if (req.account!.role === "player") {
    res.status(403).json({ error: "Only a GM can manage table sets." });
    return false;
  }
  return true;
}

export function requireTableAdmin(req: AuthedRequest, res: express.Response) {
  if (!requireTableRead(req, res)) return false;
  if (req.account!.role !== "admin") {
    res.status(403).json({ error: "Only an admin can do this." });
    return false;
  }
  return true;
}
