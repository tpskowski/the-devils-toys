import type express from "express";
import type { AuthedRequest } from "./auth.js";

/**
 * Who may do what to the systems a server offers.
 *
 * There are two levels and no more. Anyone signed in already learns which
 * systems exist from `/api/status`, so listing them in more detail is not a
 * secret; everything else is an admin's.
 *
 * That line is drawn where it is because installing a system is a change to the
 * application rather than to a room. A GM configures a room; an admin decides
 * what the server can run — the same split `table-permissions.ts` makes when it
 * reserves re-slugging and repo bundles for an admin.
 */

export function requireSystemRead(req: AuthedRequest, res: express.Response) {
  if (!req.account) {
    res.status(401).json({ error: "Sign in required." });
    return false;
  }
  return true;
}

export function requireSystemAdmin(req: AuthedRequest, res: express.Response) {
  if (!requireSystemRead(req, res)) return false;
  if (req.account!.role !== "admin") {
    res.status(403).json({ error: "Only an admin can install or retire a game system." });
    return false;
  }
  return true;
}
