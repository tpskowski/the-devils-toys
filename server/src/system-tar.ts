import { gunzipSync } from "fflate";

/**
 * Enough of tar to read a source archive, and no more.
 *
 * GitHub serves a repository as a gzipped tar whose every path is under one
 * generated directory — `devils-toys-cairn-4f1c2a…/`. That prefix is stripped
 * here, because it names the commit rather than anything about the system, and
 * a reader that kept it would find nothing where it expected the files.
 *
 * This is deliberately a reader and never a writer. Nothing below creates a
 * path, opens a file, or touches the disk: it turns bytes into a map of names to
 * bytes, and every check that decides whether those bytes may be installed
 * happens afterwards, in `system-repo.ts`.
 */

const BLOCK = 512;

/** A tar field is a fixed run of bytes, NUL- or space-padded. */
function field(block: Uint8Array, start: number, length: number) {
  let end = start;
  while (end < start + length && block[end] !== 0) end += 1;
  return new TextDecoder().decode(block.subarray(start, end)).replace(/\0+$/, "").trim();
}

function octal(block: Uint8Array, start: number, length: number) {
  const text = field(block, start, length);
  if (!text) return 0;
  const value = Number.parseInt(text, 8);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * The `path` record of a pax extended header, which is how a long name is
 * carried. Each record is `<length> <key>=<value>\n`.
 */
function paxPath(bytes: Uint8Array) {
  const text = new TextDecoder().decode(bytes);
  const match = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(text);
  return match?.[1];
}

export interface TarEntry {
  name: string;
  bytes: Uint8Array;
}

/**
 * Walks a tar archive, yielding its regular files.
 *
 * `maxBytes` is checked as the walk goes rather than after it, so an archive
 * that expands far beyond what this server accepts is abandoned partway instead
 * of being held in memory in full first.
 */
export function readTar(archive: Uint8Array, maxBytes: number): TarEntry[] {
  const entries: TarEntry[] = [];
  let total = 0;
  let offset = 0;
  // Set by a header that describes the entry after it rather than itself.
  let pendingName: string | undefined;

  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK);
    // Two zero blocks end the archive; one is enough to stop reading.
    if (header.every((byte) => byte === 0)) break;

    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0x30);
    const prefix = field(header, 345, 155);
    const name = field(header, 0, 100);
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > archive.length) break;
    const data = archive.subarray(dataStart, dataEnd);

    if (type === "x" || type === "X") {
      pendingName = paxPath(data);
    } else if (type === "L") {
      pendingName = new TextDecoder().decode(data).replace(/\0+$/, "");
    } else if (type === "0" || type === "\0") {
      total += size;
      if (total > maxBytes) throw new Error("That archive expands beyond this server's size limit.");
      entries.push({ name: pendingName ?? (prefix ? `${prefix}/${name}` : name), bytes: data });
      pendingName = undefined;
    } else {
      // A directory, link, or anything else a repository archive may carry and
      // a system has no use for. Skipped rather than refused: a repository is
      // allowed to hold things this application does not read.
      pendingName = undefined;
    }

    offset = dataEnd + ((BLOCK - (size % BLOCK)) % BLOCK);
  }

  return entries;
}

/**
 * Strips the single generated directory a source archive puts everything under.
 *
 * Only a prefix shared by every entry is removed, so an archive that is not
 * shaped that way is left exactly as it is rather than having its first path
 * segment silently eaten.
 */
export function stripArchivePrefix(entries: readonly TarEntry[]) {
  const roots = new Set(entries.map((entry) => entry.name.split("/")[0]));
  if (roots.size !== 1) return { prefix: "", entries: [...entries] };
  const [prefix] = [...roots];
  if (!prefix || entries.some((entry) => !entry.name.startsWith(`${prefix}/`))) {
    return { prefix: "", entries: [...entries] };
  }
  return {
    prefix,
    entries: entries.map((entry) => ({ ...entry, name: entry.name.slice(prefix.length + 1) }))
  };
}

export function gunzip(archive: Uint8Array, maxBytes: number): Uint8Array {
  let unpacked: Uint8Array;
  try {
    unpacked = gunzipSync(archive);
  } catch {
    throw new Error("That download is not a readable gzip archive.");
  }
  if (unpacked.byteLength > maxBytes) throw new Error("That archive expands beyond this server's size limit.");
  return unpacked;
}
