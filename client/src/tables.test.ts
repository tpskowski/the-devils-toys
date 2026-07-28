import { describe, expect, it } from "vitest";
import { rollTableLabel, type RollTableSummary } from "@devils-toys/shared";
import {
  categoryOpensTable,
  filterTables,
  groupByCategory,
  moveHighlight,
  toggleVisibility,
  visibilityNotice
} from "./tables";

const tables: RollTableSummary[] = [
  {
    id: "mishaps",
    name: "Mishaps",
    section: "CAROUSING",
    category: "CAROUSING",
    dice: "d12",
    columns: ["Result"],
    rowCount: 12,
    unreachableRows: 0
  },
  {
    id: "psionic",
    name: "D66 PSIONIC POWERS",
    section: "PSIONICS",
    category: "PSIONICS",
    dice: "d66",
    columns: ["Power"],
    rowCount: 36,
    unreachableRows: 0
  },
  {
    id: "gear",
    name: "STARTING GEAR — Signature Weapon",
    section: "BACKGROUNDS · 01 — MERCENARY",
    category: "BACKGROUNDS",
    dice: "d6",
    columns: ["Signature Weapon"],
    rowCount: 6,
    unreachableRows: 0
  },
  {
    id: "specialty",
    name: "STARTING GEAR — Old Crew Specialty",
    section: "BACKGROUNDS · 01 — MERCENARY",
    category: "BACKGROUNDS",
    dice: "d6",
    columns: ["Old Crew Specialty"],
    rowCount: 6,
    unreachableRows: 0
  },
  {
    id: "debt",
    name: "GROUP DEBT",
    section: "",
    category: "GROUP DEBT",
    dice: "d12",
    columns: ["Debt"],
    rowCount: 12,
    unreachableRows: 0
  }
];

describe("grouping tables into sections", () => {
  it("keeps book order and gathers every table of a section", () => {
    expect(groupByCategory(tables).map((group) => [group.name, group.tables.length])).toEqual([
      ["CAROUSING", 1],
      ["PSIONICS", 1],
      ["BACKGROUNDS", 2],
      ["GROUP DEBT", 1]
    ]);
  });

  it("has nothing to group in an empty set", () => {
    expect(groupByCategory([])).toEqual([]);
  });

  it("opens straight to the table when a section is a single table of the same name", () => {
    const groups = groupByCategory(tables);
    expect(categoryOpensTable(groups[3])?.id).toBe("debt");
  });

  it("shows the list for a section holding several tables", () => {
    expect(categoryOpensTable(groupByCategory(tables)[2])).toBeUndefined();
  });

  it("shows the list when a lone table is named differently from its section", () => {
    expect(categoryOpensTable(groupByCategory(tables)[0])).toBeUndefined();
  });
});

describe("finding a table by typing", () => {
  it("returns every table for an empty query", () => {
    expect(filterTables(tables, "  ")).toHaveLength(5);
  });

  it("matches on the table name regardless of case", () => {
    expect(filterTables(tables, "mishap").map((table) => table.id)).toEqual(["mishaps"]);
  });

  it("matches words spread across the name, section, and die", () => {
    expect(filterTables(tables, "d66 psionic").map((table) => table.id)).toEqual(["psionic"]);
    expect(filterTables(tables, "signature mercenary").map((table) => table.id)).toEqual(["gear"]);
  });

  it("requires every word to appear", () => {
    expect(filterTables(tables, "mishaps psionic")).toEqual([]);
  });
});

describe("naming a table", () => {
  it("adds the die when the heading does not already carry it", () => {
    expect(rollTableLabel("Mishaps", "d12")).toBe("Mishaps (d12)");
  });

  it("leaves a heading that already names its die alone", () => {
    expect(rollTableLabel("Character Traits (d10)", "d10")).toBe("Character Traits (d10)");
    expect(rollTableLabel("D44 Quality", "d44")).toBe("D44 Quality (d44)");
  });

  it("still adds the die when the heading names a different one", () => {
    expect(rollTableLabel("Starting Gear (d20)", "d6")).toBe("Starting Gear (d20) (d6)");
  });
});

describe("choosing how a roll is shared", () => {
  it("moves from the room default to the ticked option", () => {
    expect(toggleVisibility("public", "private")).toBe("private");
    expect(toggleVisibility("public", "invisible")).toBe("invisible");
    expect(toggleVisibility("public", "reveal")).toBe("reveal");
  });

  it("returns to the room default when the ticked option is cleared", () => {
    expect(toggleVisibility("reveal", "reveal")).toBe("public");
  });

  it("replaces a conflicting choice rather than combining them", () => {
    expect(toggleVisibility("private", "reveal")).toBe("reveal");
    expect(toggleVisibility("invisible", "private")).toBe("private");
  });

  it("describes each choice", () => {
    expect(visibilityNotice("private")).toMatch(/told a roll was made/);
    expect(visibilityNotice("invisible")).toMatch(/told nothing/);
    expect(visibilityNotice("reveal")).toMatch(/Everyone sees the table text/);
    expect(visibilityNotice("public")).toMatch(/not the text/);
  });
});

describe("keyboard movement through the suggestions", () => {
  it("starts at either end depending on direction", () => {
    expect(moveHighlight(-1, 1, 3)).toBe(0);
    expect(moveHighlight(-1, -1, 3)).toBe(2);
  });

  it("wraps around both ends", () => {
    expect(moveHighlight(2, 1, 3)).toBe(0);
    expect(moveHighlight(0, -1, 3)).toBe(2);
  });

  it("has nothing to highlight in an empty list", () => {
    expect(moveHighlight(0, 1, 0)).toBe(-1);
  });
});
