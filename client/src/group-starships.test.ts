import { describe, expect, it } from "vitest";
import { parseGroupStarships } from "./group-starships";

describe("group starships", () => {
  it("reads multiple starships", () => {
    expect(
      parseGroupStarships({
        starships: [
          { id: "ship-1", name: "Desdemona", hullCurrent: 8 },
          { id: "ship-2", name: "Kestrel", hullCurrent: 10 }
        ]
      })
    ).toEqual([
      { id: "ship-1", name: "Desdemona", hullCurrent: 8 },
      { id: "ship-2", name: "Kestrel", hullCurrent: 10 }
    ]);
  });

  it("preserves the legacy single starship", () => {
    expect(parseGroupStarships({ starship: { name: "Desdemona", size: "Medium" } })).toEqual([
      { id: "legacy-starship", name: "Desdemona", size: "Medium" }
    ]);
  });

  it("treats a saved empty starship list as authoritative", () => {
    expect(parseGroupStarships({ starships: [], starship: { name: "Old ship" } })).toEqual([]);
  });
});
