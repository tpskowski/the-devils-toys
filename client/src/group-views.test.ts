import { describe, expect, it } from "vitest";
import { groupViewsForDefinition, type GroupPageDefinition } from "@devils-toys/shared";
import { defaultGroupView } from "./GroupPage";

const sheet = { sections: [], lists: [] };

const hirelings = (label: string) => ({
  label,
  singularLabel: label.replace(/s$/, ""),
  rulesQuery: "Hirelings",
  creationHint: "Roll them up.",
  levelUpHint: "Not yet.",
  sheet
});

describe("the group page's tabs", () => {
  it("offers only the party when a system declares nothing else", () => {
    expect(groupViewsForDefinition({ sections: [] })).toEqual([{ id: "party", label: "Party Members" }]);
    expect(groupViewsForDefinition(undefined)).toEqual([{ id: "party", label: "Party Members" }]);
  });

  it("names the hirelings tab whatever the system calls them", () => {
    expect(groupViewsForDefinition({ sections: [], hirelings: hirelings("Hirelings") })).toEqual([
      { id: "party", label: "Party Members" },
      { id: "group", label: "Hirelings" }
    ]);
    expect(groupViewsForDefinition({ sections: [], hirelings: hirelings("Freelancers") })).toEqual([
      { id: "party", label: "Party Members" },
      { id: "group", label: "Freelancers" }
    ]);
  });

  it("adds a tab for obligations and one per kind of shared property", () => {
    const definition: GroupPageDefinition = {
      sections: [],
      hirelings: hirelings("Freelancers"),
      obligations: { label: "Group Obligations", singularLabel: "Obligation" },
      starshipSheet: sheet
    };
    expect(groupViewsForDefinition(definition)).toEqual([
      { id: "party", label: "Party Members" },
      { id: "group", label: "Freelancers" },
      { id: "obligations", label: "Group Obligations" },
      { id: "starship", label: "Starships" }
    ]);
  });

  it("does not offer an asset view until GroupPage renders and saves that asset kind", () => {
    const definition: GroupPageDefinition = {
      sections: [],
      groupAssets: [
        { kind: "stronghold", label: "Strongholds", singularLabel: "Stronghold", sheet },
        { kind: "caravan", label: "Caravans", singularLabel: "Caravan", sheet }
      ]
    };
    expect(groupViewsForDefinition(definition).map((view) => view.id)).toEqual(["party"]);
  });

  it("defaults every group page to the party", () => {
    expect(defaultGroupView()).toBe("party");
  });
});
