import { describe, expect, it } from "vitest";
import { defaultGroupView, groupViewsForSystem } from "./GroupPage";

describe("group view picker", () => {
  it("puts party members and freelancers before Monolith's other group views", () => {
    expect(groupViewsForSystem("monolith")).toEqual([
      { id: "party", label: "Party Members" },
      { id: "freelancers", label: "Freelancers" },
      { id: "obligations", label: "Group Obligations" },
      { id: "starship", label: "Starship" }
    ]);
  });

  it("puts party members before hirelings for Cairn", () => {
    expect(groupViewsForSystem("cairn")).toEqual([
      { id: "party", label: "Party Members" },
      { id: "group", label: "Hirelings" }
    ]);
  });

  it("defaults every Group page to party members", () => {
    expect(defaultGroupView("monolith")).toBe("party");
    expect(defaultGroupView("cairn")).toBe("party");
  });
});
