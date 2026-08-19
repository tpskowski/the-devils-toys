import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { extractZipEntries, readZipDirectory, refuseUnsafePaths } from "./zip-safety.js";
import { removeDataDir } from "./test-setup.js";

/**
 * These tests write real archives to a real directory, because the whole point
 * of the reader is that it never holds one in memory — a test that handed it a
 * `Uint8Array` would be testing something else.
 */
let workspace: string;
beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "devils-toys-zip-"));
});
afterEach(() => {
  removeDataDir(workspace);
});

/** Writes an archive and gives back its path. */
function archive(files: Record<string, Uint8Array | string>, options?: { level?: 0 | 6 }) {
  const file = path.join(workspace, `${Object.keys(files).length}-${Math.random().toString(36).slice(2)}.zip`);
  const contents = Object.fromEntries(
    Object.entries(files).map(([name, body]) => [name, typeof body === "string" ? strToU8(body) : body])
  );
  fs.writeFileSync(file, zipSync(contents, { level: options?.level ?? 6 }));
  return file;
}

const destination = () => fs.mkdtempSync(path.join(workspace, "out-"));
const names = (file: string) => readZipDirectory(file).entries.map((entry) => entry.name);

describe("reading an archive's directory", () => {
  it("lists every file, with the sizes it will be held to", () => {
    const file = archive({ "maps/keep.png": "an image, near enough", "campaign.md": "# Tomb" });
    const { entries, declaredBytes } = readZipDirectory(file);

    expect(entries.map((entry) => entry.name).sort()).toEqual(["campaign.md", "maps/keep.png"]);
    expect(entries.find((entry) => entry.name === "campaign.md")!.uncompressedSize).toBe(6);
    expect(declaredBytes).toBe("an image, near enough".length + 6);
  });

  it("drops the directory records, which carry no data", () => {
    expect(names(archive({ "maps/": "", "maps/keep.png": "x" }))).toEqual(["maps/keep.png"]);
  });

  it("reads a stored archive as readily as a deflated one", () => {
    expect(names(archive({ "audio/dirge.mp3": "not really an mp3" }, { level: 0 }))).toEqual(["audio/dirge.mp3"]);
  });

  it("reads an archive that carries a comment after its directory", () => {
    const file = archive({ "campaign.md": "# Tomb" });
    fs.appendFileSync(file, "trailing comment");
    const withComment = fs.readFileSync(file);
    // The comment length lives in the record itself; a reader that assumed the
    // record was the last 22 bytes would miss it.
    withComment.writeUInt16LE("trailing comment".length, withComment.length - 16 - 2);
    fs.writeFileSync(file, withComment);

    expect(names(file)).toEqual(["campaign.md"]);
  });
});

describe("what the reader refuses, and why", () => {
  it("refuses an entry that would write outside the directory", () => {
    // fflate will write the name as given, which is what makes this testable.
    const file = archive({ "../escape.png": "x" });
    expect(() => readZipDirectory(file, "campaign")).toThrow(
      /The campaign holds an entry that would write outside it: "\.\.\/escape\.png"/
    );
  });

  it("refuses an absolute path, and a Windows one", () => {
    expect(() => refuseUnsafePaths(["/etc/passwd"])).toThrow(/would write outside it/);
    expect(() => refuseUnsafePaths(["C:/Windows/system32"])).toThrow(/would write outside it/);
    expect(() => refuseUnsafePaths(["maps\\..\\..\\escape.png"])).toThrow(/would write outside it/);
  });

  it("refuses a file with no end-of-central-directory record", () => {
    const file = path.join(workspace, "not-a-zip.bin");
    fs.writeFileSync(file, Buffer.alloc(4096, 7));
    expect(() => readZipDirectory(file, "campaign")).toThrow(/no end-of-central-directory record/);
  });

  it("refuses a file too small to be an archive at all", () => {
    const file = path.join(workspace, "tiny.zip");
    fs.writeFileSync(file, Buffer.from("PK"));
    expect(() => readZipDirectory(file, "campaign")).toThrow(/too small to be a zip archive/);
  });

  it("refuses a truncated archive rather than reporting what survived", () => {
    const file = archive({ "maps/keep.png": "x".repeat(4000), "campaign.md": "# Tomb" });
    const whole = fs.readFileSync(file);
    // Keep the tail, so the end record is found and then disagrees with the file.
    fs.writeFileSync(file, Buffer.concat([whole.subarray(0, 200), whole.subarray(whole.length - 120)]));
    expect(() => readZipDirectory(file, "campaign")).toThrow(/The campaign's central directory is malformed/);
  });
});

describe("expanding an archive", () => {
  it("writes every entry where its name says, and reports what it wrote", () => {
    const file = archive({ "maps/keep.png": "an image", "npcs/vane.json": '{"name":"Vane"}' });
    const out = destination();
    const written = extractZipEntries(file, readZipDirectory(file).entries, out, { maxBytes: 1024 });

    expect(fs.readFileSync(path.join(out, "maps", "keep.png"), "utf8")).toBe("an image");
    expect(fs.readFileSync(path.join(out, "npcs", "vane.json"), "utf8")).toBe('{"name":"Vane"}');
    expect(written).toBe("an image".length + '{"name":"Vane"}'.length);
  });

  it("expands a stored entry as faithfully as a deflated one", () => {
    const body = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
    const file = archive({ "maps/keep.png": new Uint8Array(body) }, { level: 0 });
    const out = destination();
    extractZipEntries(file, readZipDirectory(file).entries, out, { maxBytes: 1024 });

    expect(fs.readFileSync(path.join(out, "maps", "keep.png")).equals(body)).toBe(true);
  });

  it("expands a body larger than one read chunk", () => {
    // Random bytes so deflate cannot flatter it into a single chunk.
    const body = Buffer.alloc(900 * 1024);
    for (let index = 0; index < body.length; index += 1) body[index] = index * 7919;
    const file = archive({ "maps/big.png": new Uint8Array(body) });
    const out = destination();
    extractZipEntries(file, readZipDirectory(file).entries, out, { maxBytes: 4 * 1024 * 1024 });

    expect(fs.readFileSync(path.join(out, "maps", "big.png")).equals(body)).toBe(true);
  });

  it("writes an entry that is empty, rather than treating it as an ending", () => {
    const file = archive({ "notes/empty.md": "", "notes/full.md": "hi" });
    const out = destination();
    const written = extractZipEntries(file, readZipDirectory(file).entries, out, { maxBytes: 1024 });

    expect(written).toBe(2);
    expect(fs.readFileSync(path.join(out, "notes", "empty.md"), "utf8")).toBe("");
  });

  it("refuses an archive that expands past the budget", () => {
    const file = archive({ "maps/keep.png": "x".repeat(5000) });
    expect(() =>
      extractZipEntries(file, readZipDirectory(file).entries, destination(), { maxBytes: 1000, source: "campaign" })
    ).toThrow(/The campaign expands beyond this server's size limit/);
  });

  /**
   * The budget is enforced on the way to disk rather than after it, so a bomb
   * costs the budget and not the disk. Without the check ahead of the write, the
   * refusal would still arrive — with five megabytes already written.
   */
  it("leaves nothing behind when it refuses over the budget", () => {
    const file = archive({ "maps/keep.png": "x".repeat(5_000_000) });
    const out = destination();
    expect(() => extractZipEntries(file, readZipDirectory(file).entries, out, { maxBytes: 1000 })).toThrow();

    const partial = path.join(out, "maps", "keep.png");
    expect(fs.existsSync(partial) ? fs.statSync(partial).size : 0).toBeLessThanOrEqual(1000);
  });

  it("refuses an entry whose data stops short of what the directory declares", () => {
    const file = archive({ "a.md": "x".repeat(1000) });
    const raw = fs.readFileSync(file);
    for (let index = 0; index + 4 <= raw.length; index += 1)
      if (raw.readUInt32LE(index) === 1000) raw.writeUInt32LE(4000, index);
    fs.writeFileSync(file, raw);

    expect(() =>
      extractZipEntries(file, readZipDirectory(file).entries, destination(), { maxBytes: 1 << 20, source: "campaign" })
    ).toThrow(/The campaign's "a\.md" is shorter than the size it declares/);
  });

  /**
   * fflate says "unexpected EOF" and nothing else, which names neither the
   * archive nor the entry. A GM reading that has no idea which of two hundred
   * files to replace.
   */
  it("names the entry when its compressed data is damaged", () => {
    const file = archive({ "maps/keep.png": "x".repeat(4000) });
    const raw = fs.readFileSync(file);
    raw.fill(0, 40, 60);
    fs.writeFileSync(file, raw);

    expect(() =>
      extractZipEntries(file, readZipDirectory(file).entries, destination(), { maxBytes: 1 << 20, source: "campaign" })
    ).toThrow(/The campaign's "maps\/keep\.png" could not be expanded: its stored data is damaged/);
  });

  it("counts the budget across entries rather than per entry", () => {
    const file = archive({ "a.md": "x".repeat(600), "b.md": "y".repeat(600) });
    expect(() => extractZipEntries(file, readZipDirectory(file).entries, destination(), { maxBytes: 1000 })).toThrow(
      /expands beyond this server's size limit/
    );
  });

  /**
   * The reason extraction counts at all. A directory is a claim: this one says
   * an entry is small, and the data behind it is not. Believing the claim is how
   * a bomb gets past a size check, so the count that matters is the one taken on
   * the way to disk.
   */
  it("refuses an entry that expands past the size its directory declares", () => {
    const file = archive({ "maps/keep.png": "x".repeat(60000) });
    const raw = fs.readFileSync(file);
    const declared = readZipDirectory(file).entries[0].uncompressedSize;
    expect(declared).toBe(60000);

    // Rewrite both copies of the size — the directory's and the local header's —
    // leaving the compressed data exactly as it was.
    let patched = 0;
    for (let index = 0; index + 4 <= raw.length; index += 1) {
      if (raw.readUInt32LE(index) !== 60000) continue;
      raw.writeUInt32LE(120, index);
      patched += 1;
    }
    expect(patched).toBeGreaterThan(0);
    fs.writeFileSync(file, raw);

    const directory = readZipDirectory(file);
    expect(directory.declaredBytes).toBe(120);
    expect(() =>
      extractZipEntries(file, directory.entries, destination(), { maxBytes: 10 * 1024 * 1024, source: "campaign" })
    ).toThrow(/The campaign's "maps\/keep\.png" expands past the size it declares/);
  });

  it("refuses a compression it cannot read", () => {
    const file = archive({ "maps/keep.png": "x" });
    const entries = readZipDirectory(file).entries.map((entry) => ({ ...entry, method: 14 }));
    expect(() => extractZipEntries(file, entries, destination(), { maxBytes: 1024, source: "campaign" })).toThrow(
      /stores "maps\/keep\.png" in a compression this application cannot read/
    );
  });

  it("refuses an unsafe name before it opens the file at all", () => {
    const file = archive({ "maps/keep.png": "x" });
    const entries = readZipDirectory(file).entries.map((entry) => ({ ...entry, name: "../escape.png" }));
    expect(() => extractZipEntries(file, entries, destination(), { maxBytes: 1024, source: "campaign" })).toThrow(
      /would write outside it/
    );
    expect(fs.existsSync(path.join(workspace, "escape.png"))).toBe(false);
  });
});
