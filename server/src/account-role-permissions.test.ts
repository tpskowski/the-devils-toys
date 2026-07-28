import { describe, expect, it } from "vitest";
import { canCreateAccountRole, requiresRoomTransferConfirmation } from "./account-role-permissions.js";

describe("account role permissions", () => {
  it("only lets GMs create player-level accounts", () => {
    expect(canCreateAccountRole("gm", "player")).toBe(true);
    expect(canCreateAccountRole("gm", "gm")).toBe(false);
    expect(canCreateAccountRole("gm", "admin")).toBe(false);
  });

  it("lets admins create every account role", () => {
    expect(canCreateAccountRole("admin", "player")).toBe(true);
    expect(canCreateAccountRole("admin", "gm")).toBe(true);
    expect(canCreateAccountRole("admin", "admin")).toBe(true);
  });

  it("requires confirmation before managed rooms are transferred on a player downgrade", () => {
    expect(requiresRoomTransferConfirmation("player", 1)).toBe(true);
    expect(requiresRoomTransferConfirmation("player", 0)).toBe(false);
    expect(requiresRoomTransferConfirmation("gm", 2)).toBe(false);
  });
});
