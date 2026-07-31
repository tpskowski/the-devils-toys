import { describe, expect, it } from "vitest";
import { parseGroupHirelings } from "./group-hirelings";

describe("group hirelings", () => {
  it("normalizes shared roster entries and ignores malformed values", () => {
    expect(parseGroupHirelings({ hirelings: [null, "bad", { name: "Moss", inventory: ["Rope"] }] })).toEqual([
      { id: "hireling-3", name: "Moss", inventory: ["Rope"] }
    ]);
  });

  it("returns an empty roster when none is stored", () => {
    expect(parseGroupHirelings({})).toEqual([]);
  });
});
