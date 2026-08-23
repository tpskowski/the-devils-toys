import { describe, expect, it } from "vitest";
import { mapLegendForSelection } from "./TableMediaViewer";

describe("map legend selection", () => {
  it("does not dereference an empty active map when the Maps tab has no map", () => {
    expect(mapLegendForSelection(null, undefined)).toBeNull();
  });
});
