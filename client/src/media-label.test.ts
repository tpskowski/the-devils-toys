import { describe, expect, it } from "vitest";
import { mediaLabel } from "./media-label";

describe("mediaLabel", () => {
  it("uses an optional display name without changing the stored filename", () => {
    expect(
      mediaLabel({ displayName: "The Black Gate", filename: "black-gate-final.webp", mimeType: "image/webp" })
    ).toBe("The Black Gate");
  });

  it("hides common image extensions from fallback labels", () => {
    expect(mediaLabel({ filename: "foggy-road.JPEG", mimeType: "image/jpeg" })).toBe("foggy-road");
  });

  it("keeps the extension for non-image references", () => {
    expect(mediaLabel({ displayName: null, filename: "mission-brief.md", mimeType: "text/markdown" })).toBe(
      "mission-brief.md"
    );
  });
});
