import { one } from "./db.js";

export function inGameDisplayName(username: string, characterName?: string | null) {
  const activeCharacter = characterName?.trim();
  return activeCharacter ? `${activeCharacter} (${username})` : username;
}

export function roomDisplayName(roomId: number, accountId: number, fallbackUsername: string) {
  const identity = one<{ username: string; character_name: string | null }>(
    `SELECT a.username, c.name AS character_name
     FROM accounts a
     LEFT JOIN memberships m ON m.account_id = a.id AND m.room_id = ?
     LEFT JOIN characters c ON c.id = m.active_character_id
     WHERE a.id = ?`,
    roomId,
    accountId
  );
  return identity ? inGameDisplayName(identity.username, identity.character_name) : fallbackUsername;
}
