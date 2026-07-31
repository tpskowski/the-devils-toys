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

/** A shared character is online while at least one account actively using it is connected. */
export function partyMemberIsOnline(
  character: Pick<RosterCharacter, "activeBy">,
  presence: readonly { accountId: number; online: boolean }[]
) {
  const onlineAccounts = new Set(presence.filter((member) => member.online).map((member) => member.accountId));
  return character.activeBy.some((member) => onlineAccounts.has(member.accountId));
}
