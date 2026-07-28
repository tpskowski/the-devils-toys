import type { AccountRole } from "@devils-toys/shared";

export function canCreateAccountRole(requesterRole: AccountRole, requestedRole: AccountRole) {
  return requesterRole === "admin" || requestedRole === "player";
}

export function requiresRoomTransferConfirmation(requestedRole: AccountRole, managedRoomCount: number) {
  return requestedRole === "player" && managedRoomCount > 0;
}
