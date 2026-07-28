import { describe, expect, it } from "vitest";
import { parseMp3Metadata } from "./mp3-metadata.js";

function syncSafe(size: number) {
  return Buffer.from([(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
}

function textFrame(id: string, value: string) {
  const payload = Buffer.concat([Buffer.from([3]), Buffer.from(value, "utf8")]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(payload.length);
  return Buffer.concat([Buffer.from(id, "ascii"), size, Buffer.alloc(2), payload]);
}

describe("MP3 metadata", () => {
  it("reads artist and title from ID3v2 text frames", () => {
    const frames = Buffer.concat([textFrame("TPE1", "The Hexes"), textFrame("TIT2", "Black Static")]);
    const file = Buffer.concat([Buffer.from("ID3\u0003\u0000\u0000", "binary"), syncSafe(frames.length), frames]);
    expect(parseMp3Metadata(file)).toEqual({ artist: "The Hexes", title: "Black Static" });
  });

  it("falls back to ID3v1 metadata", () => {
    const tag = Buffer.alloc(128);
    tag.write("TAG", 0, "ascii");
    tag.write("Old Signal", 3, "latin1");
    tag.write("Tape Ghost", 33, "latin1");
    expect(parseMp3Metadata(Buffer.concat([Buffer.from([0xff, 0xfb, 0x90]), tag]))).toEqual({
      artist: "Tape Ghost",
      title: "Old Signal"
    });
  });

  it("returns empty metadata for an untagged file", () => {
    expect(parseMp3Metadata(Buffer.from([0xff, 0xfb, 0x90]))).toEqual({ artist: null, title: null });
  });
});
