import type { RoomRole } from "@devils-toys/shared";

/** Whether this viewer may write a character record in the current room. */
export function canEditCharacter(
  viewer: { accountId: number; role: RoomRole },
  character: { ownerAccountId: number | null }
) {
  return viewer.role === "gm" || character.ownerAccountId === viewer.accountId;
}

/**
 * Whose attacks a viewer may roll. A character's belong to whoever plays them —
 * the GM writes any sheet in the room, but rolling for a player at the table is
 * not the same thing — while hirelings are the party's and creatures the GM's.
 *
 * This is a rule about whose turn it is to pick up dice, not a secret: anyone
 * can roll any die in the dice builder, so it is settled here rather than being
 * a second, weaker copy of a server permission.
 */
export function canRollAttack(
  viewer: { accountId: number; role: RoomRole },
  holder: { kind: "character"; ownerAccountId: number | null } | { kind: "hireling" } | { kind: "npc" }
) {
  if (holder.kind === "character") return holder.ownerAccountId === viewer.accountId;
  return holder.kind === "hireling" || viewer.role === "gm";
}
