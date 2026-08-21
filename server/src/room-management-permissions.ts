import type { AccountRole } from "@devils-toys/shared";

/**
 * Who may do what to a room *as a room*, rather than to what is inside it.
 *
 * The rules are the ones the admin guide already states, written down so the
 * management panel and the routes it calls cannot drift apart:
 *
 * - a **player** manages no room, ever;
 * - a **GM** makes rooms and runs the ones they are GM of, and that is all;
 * - an **admin** makes a room for somebody else, hands a room from one GM to
 *   another, and is the only account that deletes one.
 *
 * Nothing here reads the database. Whether a room is in the caller's reach is a
 * separate question, answered by the management panel's own scope.
 */

export function canManageRooms(role: AccountRole) {
  return role !== "player";
}

/** Only an admin creates a room somebody else will run. A GM creates their own. */
export function canCreateRoomForAnother(role: AccountRole) {
  return role === "admin";
}

/**
 * Handing over the GM chair changes who runs a table, so it stays with the
 * account role that answers for the server rather than for one game.
 */
export function canAssignRoomGm(role: AccountRole) {
  return role === "admin";
}

/** Deletion is admin-only and always has been; archiving is the GM's reversible one. */
export function canDeleteRoom(role: AccountRole) {
  return role === "admin";
}

/**
 * Who may be seated as a room's GM. A player-level account may not: demoting an
 * account to player already takes its rooms away from it, so seating one would
 * only be undone the next time anybody looked.
 */
export function canHoldRoomGm(role: AccountRole) {
  return role !== "player";
}
