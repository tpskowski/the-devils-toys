import { describe, expect, it } from "vitest";
import { matchesPortraitImageSignature, PORTRAIT_UPLOAD_LIMIT_BYTES } from "./portrait-files.js";

describe("character portrait files", () => {
  it("enforces a five-megabyte upload limit", () => {
    expect(PORTRAIT_UPLOAD_LIMIT_BYTES).toBe(5 * 1024 * 1024);
  });

  it("recognizes supported image signatures", () => {
    expect(matchesPortraitImageSignature("image/png", Buffer.from("89504e470d0a1a0a00000000", "hex"))).toBe(true);
    expect(matchesPortraitImageSignature("image/jpeg", Buffer.from("ffd8ff000000000000000000", "hex"))).toBe(true);
    expect(matchesPortraitImageSignature("image/webp", Buffer.from("524946460000000057454250", "hex"))).toBe(true);
  });

  it("rejects spoofed and unsupported image signatures", () => {
    expect(matchesPortraitImageSignature("image/png", Buffer.from("not a png file"))).toBe(false);
    expect(matchesPortraitImageSignature("image/gif", Buffer.from("GIF89a"))).toBe(false);
  });
});
