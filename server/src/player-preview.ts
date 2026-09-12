import type { NextFunction, Response } from "express";
import { type AuthedRequest, roomRole } from "./auth.js";
import { one } from "./db.js";
import { playerPreview } from "./preview-context.js";

/** A scoped, read-only API namespace; the normal session remains the GM's. */
export function playerPreviewMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
  const match = req.path.match(/^\/api\/player-preview\/(\d+)\/(generic|\d+)(\/.*)$/);
  if (!match) return next();
  const roomId = Number(match[1]);
  if (!req.account || roomRole(req.account.id, roomId) !== "gm")
    return res.status(403).json({ error: "Only this room's GM can preview players." });
  const accountId = match[2] === "generic" ? -1 : Number(match[2]);
  const player =
    accountId === -1
      ? { username: "Generic player" }
      : one<{ username: string }>(
          `SELECT a.username FROM accounts a JOIN memberships m ON m.account_id = a.id
     WHERE a.id = ? AND m.room_id = ? AND m.role = 'player'`,
          accountId,
          roomId
        );
  if (!player) return res.status(404).json({ error: "That player is no longer in this room." });
  if (req.method !== "GET" && req.method !== "HEAD")
    return res.status(403).json({ error: "Player preview is read-only. Changes must be made from the GM tab." });
  const path = match[3];
  if (
    ![/^\/status$/, /^\/me$/, /^\/media\/\d+\/(file|thumbnail)$/, new RegExp(`^/rooms/${roomId}(?:/|$)`)].some(
      (pattern) => pattern.test(path)
    )
  )
    return res.status(403).json({ error: "Player preview is limited to this room." });
  req.account = { id: accountId, username: player.username, role: "player", isAdmin: false };
  const prefix = `/api/player-preview/${roomId}/${match[2]}`;
  // Media, portraits, audio and downloads also pass through this boundary.
  function scoped(value: unknown): unknown {
    if (typeof value === "string" && value.startsWith("/api/")) return prefix + value.slice(4);
    if (Array.isArray(value)) return value.map(scoped);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scoped(v)]));
    return value;
  }
  const json = res.json.bind(res);
  res.json = (body: unknown) => json(scoped(body));
  res.setHeader("Cache-Control", "private, no-store");
  const setHeader = res.setHeader.bind(res);
  res.setHeader = (name, value) =>
    setHeader(name, name.toLowerCase() === "cache-control" ? "private, no-store" : value);
  req.url = `/api${path}${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`;
  playerPreview.run({ roomId, accountId }, next);
}
