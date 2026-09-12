import crypto from "node:crypto";

/** Upload replacement creates a new stored name even when the media id is retained. */
export function imageVersion(storedName: string) {
  return crypto.createHash("sha256").update(storedName).digest("hex").slice(0, 12);
}

export function imageFileUrl(id: number, storedName: string) {
  return `/api/media/${id}/file?v=${imageVersion(storedName)}`;
}
