import { describe, expect, it } from "vitest";
import { inGameDisplayName } from "./display-name.js";

describe("in-game display names", () => {
  it("leads with the active character and retains the account name", () => {
    expect(inGameDisplayName("marrow-keeper", "Sable")).toBe("Sable (marrow-keeper)");
  });

  it("uses the account name when no character is active", () => {
    expect(inGameDisplayName("marrow-keeper", null)).toBe("marrow-keeper");
    expect(inGameDisplayName("marrow-keeper", "  ")).toBe("marrow-keeper");
  });
});
