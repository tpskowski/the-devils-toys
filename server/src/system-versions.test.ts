import { describe, expect, it } from "vitest";
import { compareSystemVersions } from "@devils-toys/shared";

/**
 * The whole of decision 4, as a table. A version is whatever an author wrote, so
 * the only safe reading is: compare numbers where both sides are numbers, and
 * otherwise say whether the two strings are the same. `newer` is a claim, and it
 * is made only where it is provable.
 */
describe("comparing two dotted-numeric versions", () => {
  it.each([
    ["1.0.0", "1.0.1", "newer"],
    ["1.0.0", "1.1.0", "newer"],
    ["1.0.0", "2.0.0", "newer"],
    // The reason a string comparison will not do: "1.10.0" < "1.9.0" as text.
    ["1.9.0", "1.10.0", "newer"],
    ["1.10.0", "1.9.0", "differs"],
    ["10", "2", "differs"],
    ["2", "10", "newer"],
    ["1.0.0", "1.0.0", "same"],
    // Padded with zeros, so one version written two ways is one version.
    ["2.0", "2.0.0", "same"],
    ["2.0.0", "2.0", "same"],
    ["1", "1.0.0", "same"],
    ["2.0.0", "1.9.9", "differs"],
    ["1.0.1", "1.0.0", "differs"]
  ])("reads %s → %s as %s", (installed, available, expected) => {
    expect(compareSystemVersions(installed, available)).toBe(expected);
  });

  it("never calls a lower number an update, however it is spelt", () => {
    expect(compareSystemVersions("10.0", "2.0")).toBe("differs");
    expect(compareSystemVersions("1.2.3", "1.2")).toBe("differs");
  });
});

describe("comparing anything else", () => {
  /**
   * A pre-release, a `v` prefix, a date, a codename. None of them order against
   * a plain number in any way this application is entitled to guess at, so the
   * answer is only ever "the same string" or "not the same string".
   */
  it.each([
    ["1.0.0-rc1", "1.0.0", "differs"],
    ["1.0.0", "1.0.0-rc1", "differs"],
    ["1.0.0-rc1", "1.0.0-rc2", "differs"],
    ["1.0.0-rc1", "1.0.0-rc1", "same"],
    ["v1.2", "1.2", "differs"],
    ["1.2", "v1.2", "differs"],
    ["v1.2", "v1.3", "differs"],
    ["v1.2", "v1.2", "same"],
    ["2024-05-01", "2024-06-01", "differs"],
    ["nightly", "nightly", "same"]
  ])("reads %s → %s as %s", (installed, available, expected) => {
    expect(compareSystemVersions(installed, available)).toBe(expected);
  });

  it("never answers newer when either side is not a dotted number", () => {
    for (const [installed, available] of [
      ["1.0.0", "1.0.1-rc1"],
      ["v1.0.0", "v2.0.0"],
      ["1.0", "2.0beta"],
      ["release-one", "release-two"]
    ])
      expect(compareSystemVersions(installed, available)).not.toBe("newer");
  });
});

describe("a side that says nothing", () => {
  it.each([
    ["", "1.0.0"],
    ["1.0.0", ""],
    ["", ""],
    ["   ", "1.0.0"],
    ["1.0.0", "  "]
  ])("cannot be compared: %s → %s", (installed, available) => {
    expect(compareSystemVersions(installed, available)).toBe("unknown");
  });

  /** Surrounding space is an author's typing, not a different release. */
  it("reads a padded version as the version it is", () => {
    expect(compareSystemVersions(" 1.0.0 ", "1.0.0")).toBe("same");
    expect(compareSystemVersions("1.0.0", " 1.0.1 ")).toBe("newer");
  });
});
