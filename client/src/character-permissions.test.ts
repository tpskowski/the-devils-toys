import { describe, expect, it } from "vitest";
import { canEditCharacter } from "./character-permissions";

describe("canEditCharacter", () => {
  it("allows the room GM to edit every character", () => {
    expect(canEditCharacter({ accountId: 1, role: "gm" }, { ownerAccountId: 99 })).toBe(true);
  });

  it("allows an owner to edit their character", () => {
    expect(canEditCharacter({ accountId: 1, role: "player" }, { ownerAccountId: 1 })).toBe(true);
  });

  it("refuses another player", () => {
    expect(canEditCharacter({ accountId: 1, role: "player" }, { ownerAccountId: 2 })).toBe(false);
  });

  it("refuses players from editing an unowned pool character", () => {
    expect(canEditCharacter({ accountId: 1, role: "player" }, { ownerAccountId: null })).toBe(false);
  });
});
