import { gzipSync } from "node:zlib";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { gunzip } from "./system-tar.js";
import { unzipBounded } from "./zip-memory.js";

describe("bounded archive expansion", () => {
  it("caps gzip output inside the decompressor", () => {
    const data = Buffer.alloc(64 * 1024, 65);
    const archive = gzipSync(data);
    expect(gunzip(archive, data.length)).toEqual(data);
    expect(() => gunzip(archive, 1024)).toThrow(/size limit/);
    expect(() => gunzip(Buffer.from("invalid"), 1024)).toThrow(/readable gzip/);
  });

  it("accepts a ZIP at the total limit and refuses cumulative expansion beyond it", () => {
    const files = { "one.txt": new Uint8Array(600), "two.txt": new Uint8Array(600) };
    const archive = zipSync(files);
    expect(unzipBounded(archive, 1200, 2)).toEqual(files);
    expect(() => unzipBounded(archive, 1199, 2)).toThrow(/size limit/);
    expect(() => unzipBounded(archive, 1200, 1)).toThrow(/too many files/);
  });

  it("counts actual output even when ZIP size fields lie", () => {
    const archive = Buffer.from(zipSync({ "one.txt": new Uint8Array(64 * 1024).fill(65) }));
    // Understate both copies of the uncompressed size, as a malicious writer can.
    archive.writeUInt32LE(1, 22);
    const directory = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    archive.writeUInt32LE(1, directory + 24);
    expect(() => unzipBounded(archive, 1024, 2)).toThrow(/size limit/);
  });

  it("refuses unsafe paths before extracting them", () => {
    expect(() => unzipBounded(zipSync({ "../outside": new Uint8Array(1) }), 1024, 2)).toThrow(/outside/);
  });

  it.each(["local", "directory"])("checks traversal paths in the %s header independently", (header) => {
    const archive = Buffer.from(zipSync({ "safe.txt": new Uint8Array(1) }));
    const directory = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    archive.set(Buffer.from("../x.txt"), header === "local" ? 30 : directory + 46);
    expect(() => unzipBounded(archive, 1024, 2)).toThrow(/outside/);
  });
});
