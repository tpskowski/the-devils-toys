import { describe, expect, it } from "vitest";
import { defaultGroupView, groupViewsForSystem } from "./GroupPage";

describe("group view picker", () => {
  it("offers Party Members for every system with a Group page", () => {
    expect(groupViewsForSystem("monolith")).toContainEqual({ id: "party", label: "Party Members" });
    expect(groupViewsForSystem("cairn")).toContainEqual({ id: "party", label: "Party Members" });
  });

  it("keeps each system's existing group view as its default", () => {
    expect(defaultGroupView("monolith")).toBe("obligations");
    expect(defaultGroupView("cairn")).toBe("group");
  });
});
