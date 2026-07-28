import { describe, expect, it } from "vitest";
import { rollVisibilityNotice } from "./DiceModal";

describe("dice roll visibility notice", () => {
  it("tells a player that the GM also sees a private roll", () => {
    expect(rollVisibilityNotice("private", false)).toBe(
      "Only you and the GM see the result. The table is told a roll was made."
    );
  });

  it("uses the GM-specific private and invisible notices", () => {
    expect(rollVisibilityNotice("private", true)).toBe("Only you see the result. The table is told a roll was made.");
    expect(rollVisibilityNotice("invisible", true)).toBe("Only you see the result. The table is told nothing.");
  });
});
