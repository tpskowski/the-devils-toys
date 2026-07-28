export interface RosterCharacter {
  id: number;
  activeBy: readonly { accountId: number }[];
}

export interface RosterGroups<T> {
  /** The reader's own active character, listed first. */
  mine: T[];
  /** Characters other members of this room are currently playing. */
  party: T[];
  /** Unclaimed pool characters and characters belonging to other tables. */
  elsewhere: T[];
}

/**
 * Once a player is playing someone, the roster is about this table: their character,
 * then the rest of the party. Everything else stays behind the "show all" toggle.
 */
export function groupRoster<T extends RosterCharacter>(
  characters: readonly T[],
  accountId: number,
  activeCharacterId: number | null
): RosterGroups<T> {
  const groups: RosterGroups<T> = { mine: [], party: [], elsewhere: [] };

  for (const character of characters) {
    if (activeCharacterId !== null && character.id === activeCharacterId) groups.mine.push(character);
    else if (character.activeBy.some((member) => member.accountId !== accountId)) groups.party.push(character);
    else groups.elsewhere.push(character);
  }

  return groups;
}
