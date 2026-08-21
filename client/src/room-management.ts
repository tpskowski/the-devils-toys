import type { AccountRole, SystemId, ThemeId } from "@devils-toys/shared";

/**
 * What the Rooms section of the management panel works on: the room, whoever
 * runs it, and whoever plays in it. The panel manages a table from the room's
 * own side, which the Accounts section does from the account's — both write the
 * same memberships, and this is only the other way round.
 */
export interface ManagedRoomRecord {
  id: number;
  name: string;
  system: SystemId;
  theme: ThemeId;
  archived: boolean;
  gm: { id: number; username: string } | null;
  players: { id: number; username: string }[];
}

export interface RoomGmCandidate {
  id: number;
  username: string;
  role: AccountRole;
}

/**
 * Deleting a room is armed by typing its name, the same promise the room's own
 * settings makes. Compared trimmed, because a name pasted out of the list
 * arrives with whatever whitespace came with it and the typing was still right.
 */
export function roomDeletionArmed(typed: string, name: string) {
  return name.trim().length > 0 && typed.trim() === name.trim();
}

/** What a room's row says beneath its name: who runs it, and how many play. */
export function roomCastSummary(room: ManagedRoomRecord) {
  const gm = room.gm ? room.gm.username : "No GM";
  const players = room.players.length === 1 ? "1 player" : `${room.players.length} players`;
  return `${gm} · ${players}`;
}

/** Whether an account already plays in this room, which is what the toggle acts on. */
export function playsInRoom(room: ManagedRoomRecord, accountId: number) {
  return room.players.some((player) => player.id === accountId);
}

/**
 * The accounts that may be offered the GM chair. The one already in it is kept
 * in the list so the control can show who holds it, and a candidate is only
 * ever a GM- or admin-level account — the server refuses a player account, and
 * offering one here would only produce a refusal.
 */
export function seatableGms(candidates: RoomGmCandidate[], room: ManagedRoomRecord | undefined) {
  if (!room) return candidates;
  return candidates.filter((candidate) => candidate.role !== "player" || candidate.id === room.gm?.id);
}
