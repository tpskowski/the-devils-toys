import { Unzip, UnzipInflate, unzipSync } from "fflate";
import { refuseUnsafePaths } from "./zip-safety.js";

class ZipRefusal extends Error {}

/** Small bundles stay in memory, but expansion is counted before retaining output. */
export function unzipBounded(
  archive: Uint8Array,
  maxBytes: number,
  maxEntries: number,
  validateNames: (names: readonly string[]) => void = refuseUnsafePaths
): Record<string, Uint8Array> {
  // The streaming reader accepts arbitrary trailing bytes; require a real ZIP
  // end record as well so a truncated stream cannot masquerade as a bundle.
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let endRecord = false;
  for (let offset = archive.byteLength - 22; offset >= Math.max(0, archive.byteLength - 22 - 0xffff); offset -= 1) {
    if (
      view.getUint32(offset, true) === 0x06054b50 &&
      offset + 22 + view.getUint16(offset + 20, true) === archive.byteLength
    ) {
      endRecord = true;
      break;
    }
  }
  if (!endRecord) throw new ZipRefusal("That file is not a readable zip archive.");
  const directoryNames = new Set<string>();
  // A false filter reads only directory metadata: unzipSync never allocates or
  // inflates file output here. Check both directory and local-header paths.
  unzipSync(archive, {
    filter: (entry) => {
      validateNames([entry.name]);
      if (directoryNames.has(entry.name)) throw new ZipRefusal(`The bundle repeats "${entry.name}".`);
      directoryNames.add(entry.name);
      if (directoryNames.size > maxEntries) throw new ZipRefusal("That system bundle has too many files.");
      return false;
    }
  });
  const files: Record<string, Uint8Array> = Object.create(null);
  const names = new Set<string>();
  let expanded = 0;
  let pending = 0;
  const unzip = new Unzip((file) => {
    validateNames([file.name]);
    if (!directoryNames.has(file.name)) throw new ZipRefusal("That system bundle has inconsistent file headers.");
    if (names.has(file.name)) throw new ZipRefusal(`The bundle repeats "${file.name}".`);
    names.add(file.name);
    if (names.size > maxEntries) throw new ZipRefusal("That system bundle has too many files.");
    if (file.originalSize !== undefined && file.originalSize > maxBytes - expanded)
      throw new ZipRefusal("That system bundle expands beyond this server's size limit.");
    pending += 1;
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (error, data, final) => {
      if (error) throw error;
      expanded += data.byteLength;
      if (expanded > maxBytes) throw new ZipRefusal("That system bundle expands beyond this server's size limit.");
      chunks.push(data.slice());
      size += data.byteLength;
      if (final) {
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        files[file.name] = bytes;
        pending -= 1;
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  // Deflate has a bounded expansion ratio. Small compressed chunks bound the
  // temporary output too, even when an entry lies about its uncompressed size.
  for (let offset = 0; offset < archive.byteLength; offset += 1024)
    unzip.push(archive.subarray(offset, offset + 1024), offset + 1024 >= archive.byteLength);
  if (pending || names.size !== directoryNames.size)
    throw new ZipRefusal("That system bundle contains an incomplete file.");
  return files;
}
