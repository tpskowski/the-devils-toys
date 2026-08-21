import { describe, expect, it } from "vitest";
import { storedSystemRelease, storedSystemSource, type SystemRow } from "./system-registry.js";

/** A row is enough to exercise manifest decoding; no system needs installing. */
function row(manifest: unknown): SystemRow {
  return {
    id: "toybox",
    name: "Toybox",
    origin: "installed",
    retired: 0,
    manifest_json: JSON.stringify(manifest),
    installed_by: 1,
    installed_at: "2026-08-21T00:00:00.000Z",
    updated_at: "2026-08-21T00:00:00.000Z"
  };
}

describe("stored system release metadata", () => {
  it("normalizes a manifest from before release metadata existed", () => {
    expect(storedSystemRelease(row({ version: "1.0.0" }))).toEqual({
      version: "1.0.0",
      breaking: false,
      releaseNotes: []
    });
  });

  it("returns the breaking declaration and notes an install recorded", () => {
    expect(
      storedSystemRelease(
        row({
          version: "2.0.0",
          breaking: true,
          releaseNotes: ["Rebuild characters using the new creation flow."]
        })
      )
    ).toEqual({
      version: "2.0.0",
      breaking: true,
      releaseNotes: ["Rebuild characters using the new creation flow."]
    });
  });

  it("keeps release metadata alongside a repository source", () => {
    const stored = storedSystemSource(
      row({
        version: "2.0.0",
        breaking: true,
        releaseNotes: ["Retire the old group sheet."],
        source: { repository: "owner/toybox", ref: "main", revision: "abc1234", fetchedAt: "2026-08-21" }
      })
    );

    expect(stored).toMatchObject({
      repository: "owner/toybox",
      version: "2.0.0",
      breaking: true,
      releaseNotes: ["Retire the old group sheet."]
    });
  });
});
