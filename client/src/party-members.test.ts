import { describe, expect, it } from "vitest";
import { otherPartyMembers, partyMemberIsOnline } from "./party-members";

describe("other party members", () => {
  it("returns only other users' active characters", () => {
    const characters = [
      { id: 1, ownerAccountId: 7, activeBy: [{ accountId: 7 }] },
      { id: 2, ownerAccountId: 8, activeBy: [{ accountId: 8 }] },
      { id: 3, ownerAccountId: 9, activeBy: [] }
    ];

    expect(otherPartyMembers(characters, 7, 1).map((character) => character.id)).toEqual([2]);
  });

  it("excludes a shared character whenever the reader is one of its active users", () => {
    const characters = [
      { id: 4, ownerAccountId: 8, activeBy: [{ accountId: 7 }, { accountId: 8 }] },
      { id: 5, ownerAccountId: 9, activeBy: [{ accountId: 9 }] }
    ];

    expect(otherPartyMembers(characters, 7, null).map((character) => character.id)).toEqual([5]);
  });
});

describe("party member presence", () => {
  it("marks a character online when any active user is connected", () => {
    const character = { activeBy: [{ accountId: 8 }, { accountId: 9 }] };
    expect(
      partyMemberIsOnline(character, [
        { accountId: 8, online: false },
        { accountId: 9, online: true }
      ])
    ).toBe(true);
  });

  it("marks a character offline when none of its active users are connected", () => {
    expect(partyMemberIsOnline({ activeBy: [{ accountId: 8 }] }, [{ accountId: 8, online: false }])).toBe(false);
  });
});
