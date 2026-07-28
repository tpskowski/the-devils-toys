import fs from "node:fs";

export interface Mp3Metadata {
  artist: string | null;
  title: string | null;
}

function syncSafe(bytes: Uint8Array) {
  return ((bytes[0] & 0x7f) << 21) | ((bytes[1] & 0x7f) << 14) | ((bytes[2] & 0x7f) << 7) | (bytes[3] & 0x7f);
}

function clean(value: string) {
  return value
    .replace(/\u0000+/g, " / ")
    .replace(/\s*\/\s*$/, "")
    .trim();
}

function decodeBigEndianUtf16(bytes: Buffer) {
  const usable = bytes.subarray(0, bytes.length - (bytes.length % 2));
  const swapped = Buffer.alloc(usable.length);
  for (let index = 0; index < usable.length; index += 2) {
    swapped[index] = usable[index + 1];
    swapped[index + 1] = usable[index];
  }
  return swapped.toString("utf16le");
}

function decodeTextFrame(payload: Buffer) {
  if (payload.length < 2) return "";
  const encoding = payload[0];
  const text = payload.subarray(1);
  if (encoding === 0) return clean(text.toString("latin1"));
  if (encoding === 3) return clean(text.toString("utf8"));
  if (encoding === 2) return clean(decodeBigEndianUtf16(text));
  if (encoding === 1) {
    if (text[0] === 0xff && text[1] === 0xfe) return clean(text.subarray(2).toString("utf16le"));
    if (text[0] === 0xfe && text[1] === 0xff) return clean(decodeBigEndianUtf16(text.subarray(2)));
    return clean(text.toString("utf16le"));
  }
  return "";
}

function id3v1(buffer: Buffer): Mp3Metadata {
  if (buffer.length < 128) return { artist: null, title: null };
  const tag = buffer.subarray(buffer.length - 128);
  if (tag.subarray(0, 3).toString("ascii") !== "TAG") return { artist: null, title: null };
  return {
    title: clean(tag.subarray(3, 33).toString("latin1")) || null,
    artist: clean(tag.subarray(33, 63).toString("latin1")) || null
  };
}

export function parseMp3Metadata(buffer: Buffer): Mp3Metadata {
  const fallback = id3v1(buffer);
  if (buffer.length < 10 || buffer.subarray(0, 3).toString("ascii") !== "ID3") return fallback;

  const version = buffer[3];
  if (version < 2 || version > 4) return fallback;
  const tagEnd = Math.min(buffer.length, 10 + syncSafe(buffer.subarray(6, 10)));
  let offset = 10;
  if (buffer[5] & 0x40) {
    if (version === 3 && offset + 4 <= tagEnd) offset += 4 + buffer.readUInt32BE(offset);
    else if (version === 4 && offset + 4 <= tagEnd) offset += syncSafe(buffer.subarray(offset, offset + 4));
  }

  let artist: string | null = null;
  let title: string | null = null;
  while (offset < tagEnd) {
    const headerSize = version === 2 ? 6 : 10;
    if (offset + headerSize > tagEnd) break;
    const idLength = version === 2 ? 3 : 4;
    const id = buffer.subarray(offset, offset + idLength).toString("ascii");
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const frameSize =
      version === 2
        ? (buffer[offset + 3] << 16) | (buffer[offset + 4] << 8) | buffer[offset + 5]
        : version === 4
          ? syncSafe(buffer.subarray(offset + 4, offset + 8))
          : buffer.readUInt32BE(offset + 4);
    const start = offset + headerSize;
    const end = start + frameSize;
    if (frameSize <= 0 || end > tagEnd) break;
    if (id === "TIT2" || id === "TT2") title = decodeTextFrame(buffer.subarray(start, end)) || title;
    if (id === "TPE1" || id === "TP1") artist = decodeTextFrame(buffer.subarray(start, end)) || artist;
    offset = end;
  }
  return { artist: artist ?? fallback.artist, title: title ?? fallback.title };
}

export function readMp3Metadata(filename: string) {
  return parseMp3Metadata(fs.readFileSync(filename));
}
