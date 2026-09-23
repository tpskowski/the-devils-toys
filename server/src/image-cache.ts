import crypto from "node:crypto";
import type { Request, Response } from "express";
import { playerPreview } from "./preview-context.js";

/** Call only after the simulated player's access and image version are checked.
 * The uncached redirect rechecks access on every preview, while the actual image
 * shares the ordinary session's private browser cache across player switches.
 */
export function redirectPreviewImage(req: Request, res: Response) {
  if (!playerPreview.getStore() || typeof req.query.v !== "string" || !req.query.v) return false;
  const target = req.originalUrl.replace(/^\/api\/player-preview\/\d+\/(?:generic|\d+)\//, "/api/");
  res.redirect(307, target);
  return true;
}

/** Upload replacement creates a new stored name even when the media id is retained. */
export function imageVersion(storedName: string) {
  return crypto.createHash("sha256").update(storedName).digest("hex").slice(0, 12);
}

export function imageFileUrl(id: number, storedName: string) {
  return `/api/media/${id}/file?v=${imageVersion(storedName)}`;
}
