import { describe, expect, it } from "vitest";
import { requiresOwnedRoomDowngradeWarning } from "./account-roles";

describe("account role controls", () => {
  it("warns before downgrading a GM who has a game room", () => {
    expect(requiresOwnedRoomDowngradeWarning("gm", "player", 1)).toBe(true);
  });

  it("does not warn for promotion or a GM without rooms", () => {
    expect(requiresOwnedRoomDowngradeWarning("player", "gm", 0)).toBe(false);
    expect(requiresOwnedRoomDowngradeWarning("gm", "player", 0)).toBe(false);
  });
});
