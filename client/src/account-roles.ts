import type { AccountRole } from "@devils-toys/shared";

export const accountRoleLabels: Record<AccountRole, string> = {
  admin: "Server admin",
  gm: "Game master",
  player: "Player"
};

export function requiresOwnedRoomDowngradeWarning(
  currentRole: AccountRole,
  requestedRole: AccountRole,
  ownedRoomCount: number
) {
  return currentRole !== "player" && requestedRole === "player" && ownedRoomCount > 0;
}
