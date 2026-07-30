import { groupRoster, type RosterCharacter } from "./character-roster";

interface PartyMemberCharacter extends RosterCharacter {
  ownerAccountId: number | null;
}

/** Active characters belonging to other people at this table, never the reader. */
export function otherPartyMembers<T extends PartyMemberCharacter>(
  characters: readonly T[],
  viewerId: number,
  activeCharacterId: number | null
) {
  return groupRoster(characters, viewerId, activeCharacterId).party.filter(
    (character) =>
      character.ownerAccountId !== viewerId && character.activeBy.every((member) => member.accountId !== viewerId)
  );
}
