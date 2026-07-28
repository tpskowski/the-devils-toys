import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export const PORTRAIT_UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024;

export const portraitImageTypes = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"]
]);

export function matchesPortraitImageSignature(mimeType: string, bytes: Uint8Array) {
  if (mimeType === "image/png") return Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/webp")
    return (
      Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
      Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
    );
  return false;
}

export function validPortraitFile(file: Express.Multer.File) {
  const bytes = Buffer.alloc(12);
  const descriptor = fs.openSync(file.path, "r");
  try {
    fs.readSync(descriptor, bytes, 0, bytes.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return matchesPortraitImageSignature(file.mimetype, bytes);
}

export function removeUploadedPortrait(file?: Express.Multer.File) {
  if (!file || path.basename(file.filename) !== file.filename) return;
  try {
    fs.rmSync(file.path, { force: true });
  } catch {
    // The failed request remains authoritative if an already-missing upload cannot be removed.
  }
}

export function removeStoredPortrait(storedName?: string | null) {
  if (!storedName || path.basename(storedName) !== storedName) return;
  try {
    fs.rmSync(path.join(config.dataDir, "uploads", storedName), { force: true });
  } catch {
    // The database remains authoritative if an already-missing portrait cannot be removed.
  }
}
