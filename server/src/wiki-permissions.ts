import type express from "express";
import type { AuthedRequest, AuthAccount } from "./auth.js";
import { one } from "./db.js";
import { roomAccessRole } from "./room-config-permissions.js";

/** The columns access control needs; routes retain the remaining page fields. */
export interface WikiPagePermissionRow {
  room_id: number;
  owner_account_id: number | null;
  visible: number;
}

export interface WikiFolderPermissionRow {
  room_id: number;
  owner_account_id: number | null;
}

/** A room membership only grants wiki access while the GM has it enabled. */
export function wikiRole(account: AuthAccount, roomId: number): "gm" | "player" | undefined {
  if (!Number.isInteger(roomId) || roomId <= 0) return;
  if (!one<{ wiki_enabled: number }>("SELECT wiki_enabled FROM rooms WHERE id = ?", roomId)?.wiki_enabled) return;
  return roomAccessRole(account, roomId);
}

export function mayReadWikiFile(account: AuthAccount, page: WikiPagePermissionRow): boolean {
  const role = wikiRole(account, page.room_id);
  return role === "gm" || (role === "player" && (page.owner_account_id === account.id || Boolean(page.visible)));
}

export function mayEditWikiFile(account: AuthAccount, page: WikiPagePermissionRow): boolean {
  const role = wikiRole(account, page.room_id);
  return role === "gm" || (role === "player" && page.owner_account_id === account.id);
}

export function mayManageWikiFolder(account: AuthAccount, folder: WikiFolderPermissionRow): boolean {
  const role = wikiRole(account, folder.room_id);
  return role === "gm" || (role === "player" && folder.owner_account_id === account.id);
}

/** GM-only changes to room-wide wiki access, such as sharing a page. */
export function requireWikiGm(req: AuthedRequest, res: express.Response): number | undefined {
  const roomId = Number(req.params.roomId);
  const role = wikiRole(req.account!, roomId);
  if (!role) {
    res.status(404).json({ error: "Wiki not found." });
    return;
  }
  if (role !== "gm") {
    res.status(403).json({ error: "Only the room GM can manage wiki sharing." });
    return;
  }
  return roomId;
}
