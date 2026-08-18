import fs from "node:fs";
import path from "node:path";
import { Inflate } from "fflate";

/**
 * Reading an archive without holding it.
 *
 * A system bundle is a hundred kilobytes of JSON and Markdown, so `unzipSync`
 * reads the whole thing into memory and everything is fine. A campaign is a
 * hundred maps and forty music tracks, and the same approach would put a
 * gigabyte of compressed archive and a gigabyte of decompressed output in the
 * heap at once, on a server whose whole job is to be small enough to run beside
 * the game it is hosting.
 *
 * So this reads the **central directory** instead. A zip records every entry
 * twice: once in a local header before its data, and once in a directory at the
 * end of the file listing every name, both sizes, and where the data is. Reading
 * that tail answers what is in an archive, how big it claims to be, and whether
 * it is allowed here — for two seeks and no decompression, at any archive size.
 * Only once an archive has been accepted whole is anything expanded, one entry
 * at a time, against a byte counter that does not take the directory's word for
 * it.
 *
 * Nothing here knows what a campaign or a system is. It reads zips, refuses the
 * ones that would hurt, and writes files into a directory it is given.
 */

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** The fixed part of an end-of-central-directory record, before its comment. */
const EOCD_SIZE = 22;
/** A zip comment is a 16-bit length, so the record cannot start further back than this. */
const MAX_COMMENT = 0xffff;
const ZIP64_LOCATOR_SIZE = 20;
/** The two compression methods a zip may use here: stored, and deflate. */
const STORED = 0;
const DEFLATED = 8;
/** Reads and writes move in chunks of this, so a large entry never lands in the heap whole. */
const CHUNK = 256 * 1024;

/**
 * An error this module raised, as against one thrown from inside a decompressor.
 * The difference matters in one place: a failure part-way through an entry has to
 * be reported as that entry being unreadable, and fflate — which knows nothing of
 * the file it is inflating — says only "unexpected EOF".
 */
class ArchiveRefusal extends Error {}

export interface ZipEntry {
  /** The path inside the archive, with separators normalised to `/`. */
  name: string;
  compressedSize: number;
  /** What the directory *claims* the expanded entry weighs. Checked, never trusted. */
  uncompressedSize: number;
  method: number;
  /** Where the entry's local header begins, which is where its data is found. */
  headerOffset: number;
}

/**
 * Refuses anything absolute and anything reaching upwards — the zip-slip check,
 * which has to happen before a single byte is written. Kept apart from any
 * allowlist because what a given archive may *contain* differs by what it is,
 * but nothing may ever hold a path that escapes the directory it is written into.
 */
export function refuseUnsafePaths(names: readonly string[], source = "bundle") {
  for (const name of names) {
    const normalized = name.replace(/\\/g, "/");
    if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").includes(".."))
      throw new ArchiveRefusal(`The ${source} holds an entry that would write outside it: "${name}".`);
  }
}

/** A 64-bit field that cannot be an offset or a size this process can act on. */
function toSafeNumber(value: bigint, what: string) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new ArchiveRefusal(`This archive's ${what} is larger than can be read.`);
  return Number(value);
}

function readAt(descriptor: number, position: number, length: number) {
  const buffer = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const count = fs.readSync(descriptor, buffer, read, length - read, position + read);
    if (count <= 0) break;
    read += count;
  }
  if (read < length) throw new ArchiveRefusal("This archive ends sooner than it says it does.");
  return buffer;
}

interface Directory {
  offset: number;
  size: number;
  entries: number;
}

/**
 * Finds the end-of-central-directory record, which is the only fixed point in a
 * zip: everything else is found through it. It sits at the very end unless the
 * archive carries a comment, so the last 64 KB are scanned backwards for its
 * signature — and a candidate is only believed when its stated comment length
 * accounts for exactly the bytes after it, since four bytes that happen to look
 * like a signature can appear in compressed data.
 */
function readEndRecord(descriptor: number, fileSize: number, source: string): Directory {
  if (fileSize < EOCD_SIZE) throw new ArchiveRefusal(`The ${source} is too small to be a zip archive.`);
  const span = Math.min(fileSize, EOCD_SIZE + MAX_COMMENT);
  const tail = readAt(descriptor, fileSize - span, span);

  let start = -1;
  for (let index = span - EOCD_SIZE; index >= 0; index -= 1) {
    if (tail.readUInt32LE(index) !== EOCD_SIGNATURE) continue;
    if (tail.readUInt16LE(index + 20) === span - index - EOCD_SIZE) {
      start = index;
      break;
    }
  }
  if (start < 0)
    throw new ArchiveRefusal(
      `The ${source} has no end-of-central-directory record, so it is not a readable zip archive.`
    );

  const entries = tail.readUInt16LE(start + 10);
  const size = tail.readUInt32LE(start + 12);
  const offset = tail.readUInt32LE(start + 16);
  // Every one of these fields is a sentinel meaning "too large to state here",
  // and any of them appearing sends the reader to the zip64 record instead.
  // Plenty of writers emit zip64 well below 4 GB, so this is not an exotic path.
  if (entries !== 0xffff && size !== 0xffffffff && offset !== 0xffffffff) return { offset, size, entries };

  const locatorStart = fileSize - span + start - ZIP64_LOCATOR_SIZE;
  if (locatorStart < 0) throw new ArchiveRefusal(`The ${source} claims to be zip64 but carries no zip64 locator.`);
  const locator = readAt(descriptor, locatorStart, ZIP64_LOCATOR_SIZE);
  if (locator.readUInt32LE(0) !== ZIP64_LOCATOR_SIGNATURE)
    throw new ArchiveRefusal(`The ${source} claims to be zip64 but carries no zip64 locator.`);

  const recordStart = toSafeNumber(locator.readBigUInt64LE(8), "zip64 directory offset");
  const record = readAt(descriptor, recordStart, 56);
  if (record.readUInt32LE(0) !== ZIP64_EOCD_SIGNATURE)
    throw new ArchiveRefusal(`The ${source}'s zip64 locator does not point at a zip64 directory.`);
  return {
    entries: toSafeNumber(record.readBigUInt64LE(32), "entry count"),
    size: toSafeNumber(record.readBigUInt64LE(40), "directory size"),
    offset: toSafeNumber(record.readBigUInt64LE(48), "directory offset")
  };
}

/**
 * The zip64 extended information extra field, which is where a size or an offset
 * goes when it will not fit in the four bytes reserved for it. Its contents are
 * positional: only the fields whose ordinary slot held the sentinel are present,
 * in a fixed order, so it is read in that order or not at all.
 */
function readZip64Extra(extra: Buffer, wants: { size: boolean; compressed: boolean; offset: boolean }) {
  for (let cursor = 0; cursor + 4 <= extra.length;) {
    const id = extra.readUInt16LE(cursor);
    const length = extra.readUInt16LE(cursor + 2);
    const body = extra.subarray(cursor + 4, cursor + 4 + length);
    cursor += 4 + length;
    if (id !== 0x0001) continue;

    let at = 0;
    const take = (what: string) => {
      if (at + 8 > body.length)
        throw new ArchiveRefusal(`An entry's zip64 record does not carry the ${what} it promises.`);
      const value = toSafeNumber(body.readBigUInt64LE(at), what);
      at += 8;
      return value;
    };
    return {
      uncompressedSize: wants.size ? take("expanded size") : undefined,
      compressedSize: wants.compressed ? take("stored size") : undefined,
      headerOffset: wants.offset ? take("entry offset") : undefined
    };
  }
  return {};
}

export interface ZipDirectory {
  entries: ZipEntry[];
  /** What the archive would weigh expanded, by its own account. */
  declaredBytes: number;
}

/**
 * Every file in an archive, read from its directory.
 *
 * Directory records — the entries whose names end in `/` — are dropped: they
 * carry no data, and every caller would otherwise have to remember to skip them.
 * Unsafe paths are refused here rather than left to the caller, because a caller
 * that forgets is a caller that writes outside the directory it was given.
 *
 * Nothing is decompressed, and nothing larger than the directory itself is read.
 */
export function readZipDirectory(file: string, source = "archive"): ZipDirectory {
  const descriptor = fs.openSync(file, "r");
  try {
    const fileSize = fs.fstatSync(descriptor).size;
    const directory = readEndRecord(descriptor, fileSize, source);
    if (directory.offset + directory.size > fileSize)
      throw new ArchiveRefusal(
        `The ${source}'s directory reaches past the end of the file, so the archive is truncated.`
      );
    const table = readAt(descriptor, directory.offset, directory.size);

    const entries: ZipEntry[] = [];
    const names: string[] = [];
    let declaredBytes = 0;
    for (let cursor = 0; cursor + 46 <= table.length;) {
      if (table.readUInt32LE(cursor) !== CENTRAL_SIGNATURE)
        throw new ArchiveRefusal(`The ${source}'s central directory is malformed, so the archive cannot be read.`);
      const method = table.readUInt16LE(cursor + 10);
      let compressedSize = table.readUInt32LE(cursor + 20);
      let uncompressedSize = table.readUInt32LE(cursor + 24);
      const nameLength = table.readUInt16LE(cursor + 28);
      const extraLength = table.readUInt16LE(cursor + 30);
      const commentLength = table.readUInt16LE(cursor + 32);
      let headerOffset = table.readUInt32LE(cursor + 42);

      const nameAt = cursor + 46;
      const extraAt = nameAt + nameLength;
      if (extraAt + extraLength + commentLength > table.length)
        throw new ArchiveRefusal(`The ${source}'s central directory is malformed, so the archive cannot be read.`);
      const name = table.subarray(nameAt, extraAt).toString("utf8").replace(/\\/g, "/");

      const wants = {
        size: uncompressedSize === 0xffffffff,
        compressed: compressedSize === 0xffffffff,
        offset: headerOffset === 0xffffffff
      };
      if (wants.size || wants.compressed || wants.offset) {
        const wide = readZip64Extra(table.subarray(extraAt, extraAt + extraLength), wants);
        uncompressedSize = wide.uncompressedSize ?? uncompressedSize;
        compressedSize = wide.compressedSize ?? compressedSize;
        headerOffset = wide.headerOffset ?? headerOffset;
      }

      cursor = extraAt + extraLength + commentLength;
      names.push(name);
      if (name.endsWith("/")) continue;
      entries.push({ name, compressedSize, uncompressedSize, method, headerOffset });
      declaredBytes += uncompressedSize;
    }

    refuseUnsafePaths(names, source);
    return { entries, declaredBytes };
  } finally {
    fs.closeSync(descriptor);
  }
}

export interface ExtractionLimits {
  /**
   * The most this extraction may write in total, expanded. Enforced against what
   * actually comes out rather than against what the directory claimed, which is
   * the difference between a limit and a suggestion: a bomb states a modest size
   * and then delivers whatever it likes.
   */
  maxBytes: number;
  /** Named in the refusals, so a message says "campaign" where that is what the reader is holding. */
  source?: string;
}

/**
 * An entry's data begins after its **local** header, whose name and extra fields
 * are allowed to be a different length from the directory's copy of them. Taking
 * the directory's lengths here is a bug that reads a few bytes into the middle of
 * the data and produces nonsense far away, so the local header is read again.
 */
function dataOffset(descriptor: number, entry: ZipEntry, source: string) {
  const header = readAt(descriptor, entry.headerOffset, 30);
  if (header.readUInt32LE(0) !== LOCAL_SIGNATURE)
    throw new ArchiveRefusal(`The ${source} has no entry where it says "${entry.name}" is.`);
  return entry.headerOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
}

/**
 * Expands entries into a directory, one at a time, counting what comes out.
 *
 * Returns the bytes written. Two things are refused mid-entry rather than after:
 * an entry that expands past what its directory record claimed, and a total that
 * passes the budget. Both stop at the moment they are known, so a bomb costs the
 * budget and not the disk.
 */
export function extractZipEntries(
  file: string,
  entries: readonly ZipEntry[],
  destination: string,
  limits: ExtractionLimits
) {
  const source = limits.source ?? "archive";
  refuseUnsafePaths(
    entries.map((entry) => entry.name),
    source
  );

  const descriptor = fs.openSync(file, "r");
  const chunk = Buffer.alloc(CHUNK);
  let written = 0;
  try {
    for (const entry of entries) {
      if (entry.method !== STORED && entry.method !== DEFLATED)
        throw new ArchiveRefusal(`The ${source} stores "${entry.name}" in a compression this application cannot read.`);

      const target = path.join(destination, entry.name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const output = fs.openSync(target, "w");
      let entryWritten = 0;

      const take = (data: Uint8Array) => {
        entryWritten += data.byteLength;
        written += data.byteLength;
        // Both checks live here, on the way to disk, because this is the only
        // place that knows what the archive actually contained rather than what
        // it said it did.
        if (entryWritten > entry.uncompressedSize)
          throw new ArchiveRefusal(`The ${source}'s "${entry.name}" expands past the size it declares.`);
        if (written > limits.maxBytes)
          throw new ArchiveRefusal(`The ${source} expands beyond this server's size limit.`);
        fs.writeSync(output, data);
      };

      try {
        const inflate = new Inflate();
        inflate.ondata = take;
        let position = dataOffset(descriptor, entry, source);
        let remaining = entry.compressedSize;
        do {
          const wanted = Math.min(remaining, CHUNK);
          const read = wanted === 0 ? 0 : fs.readSync(descriptor, chunk, 0, wanted, position);
          if (read === 0 && remaining > 0)
            throw new ArchiveRefusal(`The ${source} ends part-way through "${entry.name}".`);
          position += read;
          remaining -= read;
          const data = new Uint8Array(chunk.subarray(0, read));
          if (entry.method === STORED) take(data);
          else inflate.push(data, remaining === 0);
        } while (remaining > 0);
      } catch (cause) {
        // Our own refusals already name the archive and the entry. Anything else
        // came out of the decompressor, which knows only that the bytes it was
        // given stopped making sense — and "unexpected EOF" is not something a
        // GM can act on, where "this entry is damaged" is.
        if (cause instanceof ArchiveRefusal) throw cause;
        throw new ArchiveRefusal(`The ${source}'s "${entry.name}" could not be expanded: its stored data is damaged.`);
      } finally {
        fs.closeSync(output);
      }

      // A short entry is as much a broken archive as an over-long one, and it is
      // worth catching here: the alternative is a truncated map that only fails
      // when someone opens it mid-session.
      if (entryWritten !== entry.uncompressedSize)
        throw new ArchiveRefusal(`The ${source}'s "${entry.name}" is shorter than the size it declares.`);
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return written;
}
