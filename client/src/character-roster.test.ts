import { describe, expect, it } from "vitest";
import { groupRoster } from "./character-roster";

const me = 7;
const mate = 8;

const roster = [
  { id: 1, activeBy: [{ accountId: me }] },
  { id: 2, activeBy: [{ accountId: mate }] },
  { id: 3, activeBy: [] },
  { id: 4, activeBy: [] },
  { id: 5, activeBy: [{ accountId: mate }, { accountId: me }] }
];

const ids = (group: { id: number }[]) => group.map((item) => item.id);

describe("character roster grouping", () => {
  it("leads with the reader's active character and gathers the rest of the party", () => {
    const groups = groupRoster(roster, me, 1);

    expect(ids(groups.mine)).toEqual([1]);
    expect(ids(groups.party)).toEqual([2, 5]);
    expect(ids(groups.elsewhere)).toEqual([3, 4]);
  });

  it("counts a character shared with another member as party, not as the reader's own", () => {
    const groups = groupRoster(roster, me, 5);

    expect(ids(groups.mine)).toEqual([5]);
    expect(ids(groups.party)).toEqual([2]);
  });

  it("treats unplayed characters as elsewhere so they can be tucked away", () => {
    const groups = groupRoster(roster, me, 1);

    expect(groups.elsewhere.every((character) => character.activeBy.length === 0)).toBe(true);
  });

  it("puts nothing in the reader's group when they have no active character", () => {
    const groups = groupRoster(roster, me, null);

    expect(groups.mine).toEqual([]);
    expect(ids(groups.party)).toEqual([2, 5]);
    expect(ids(groups.elsewhere)).toEqual([1, 3, 4]);
  });
});
