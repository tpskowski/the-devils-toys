import { describe, expect, it } from "vitest";
import type { GameSystem } from "@devils-toys/shared";
import { rollHirelingCreation } from "./character-creation.js";
import { parseCompactRollTables } from "./roll-tables.js";

/**
 * Hireling creation, against a book written for the purpose.
 *
 * This used to read `raw/Monolith.md` and Monolith's own `creationRoll`. Neither
 * is in this repository now, so the test states both — which makes what it is
 * actually asserting visible: that every configured roll is read from the
 * Markdown, that the low end of each is reachable, and that the high end is too.
 * Two rows per table is all that takes.
 */
/**
 * A compact table, in the shape the parser reads: a heading, a dice column, and
 * one row per face. Every face has to be present or the dice size is inferred
 * from the highest row, so the filler rows are load-bearing rather than padding.
 */
function table(name: string, sides: number, first: string, last: string) {
  const rows = Array.from({ length: sides }, (_, index) => {
    const roll = index + 1;
    const result = roll === 1 ? first : roll === sides ? last : `${name} ${roll}`;
    return `| ${roll} | ${result} |`;
  });
  return [`### ${name}`, "", `| d${sides} | Result |`, "| --- | --- |", ...rows, ""].join("\n");
}

const markdown = [
  // The first heading is the document's title, so the section the tables are
  // filtered by has to come after one.
  "# A Book",
  "",
  "## FINISHING TOUCHES",
  "",
  table("Physique", 10, "Athletic", "Scarred"),
  table("Hair", 10, "Bald", "Dyed"),
  table("Face", 10, "Boney", "Friendly"),
  table("Mannerisms", 10, "Blunt", "On-Edge"),
  table("Clothing Style", 10, "Antiquated", "Flamboyant"),
  table("Male Names", 20, "Goro", "Juda"),
  table("Female Names", 20, "Ama", "Wren"),
  table("Ambiguous Names", 20, "Ash", "Rill"),
  table("Last Names", 20, "Chapel", "Bones")
].join("\n");

const definition: NonNullable<NonNullable<GameSystem["groupPage"]>["hirelings"]>["creationRoll"] = {
  abilities: [
    { currentKey: "strCurrent", maximumKey: "strMax", dice: "3d6" },
    { currentKey: "dexCurrent", maximumKey: "dexMax", dice: "3d6" },
    { currentKey: "wilCurrent", maximumKey: "wilMax", dice: "3d6" }
  ],
  hitProtection: { currentKey: "hpCurrent", maximumKey: "hpMax", dice: "1d6" },
  weapon: "Standard weapon (D6)",
  finishingTouches: {
    section: "FINISHING TOUCHES",
    details: ["Physique", "Hair", "Face", "Mannerisms", "Clothing Style"],
    firstNames: ["Male Names", "Female Names", "Ambiguous Names"],
    lastName: "Last Names"
  }
};

describe("hireling creation", () => {
  it("reads every configured table from the authoritative Markdown", () => {
    expect(parseCompactRollTables(markdown, "FINISHING TOUCHES").map((table) => [table.name, table.dice])).toEqual([
      ["Physique", "d10"],
      ["Hair", "d10"],
      ["Face", "d10"],
      ["Mannerisms", "d10"],
      ["Clothing Style", "d10"],
      ["Male Names", "d20"],
      ["Female Names", "d20"],
      ["Ambiguous Names", "d20"],
      ["Last Names", "d20"]
    ]);
  });

  it("fills scores, HP, weapon, name, and finishing touches", () => {
    expect(rollHirelingCreation(definition!, { kind: "markdown", markdown }, () => 0)).toEqual({
      strCurrent: 3,
      strMax: 3,
      dexCurrent: 3,
      dexMax: 3,
      wilCurrent: 3,
      wilMax: 3,
      hpCurrent: 1,
      hpMax: 1,
      weapon: "Standard weapon (D6)",
      name: "Goro Chapel",
      details: [
        "Physique: Athletic",
        "Hair: Bald",
        "Face: Boney",
        "Mannerisms: Blunt",
        "Clothing Style: Antiquated"
      ].join("\n")
    });
  });

  it("can reach the last entry of every configured roll", () => {
    expect(rollHirelingCreation(definition!, { kind: "markdown", markdown }, () => 0.999)).toMatchObject({
      strCurrent: 18,
      strMax: 18,
      dexCurrent: 18,
      dexMax: 18,
      wilCurrent: 18,
      wilMax: 18,
      hpCurrent: 6,
      hpMax: 6,
      // The same roll that reaches the last row also picks the last of the three
      // first-name tables, so this is Ambiguous Names' last entry, not Male's.
      name: "Rill Bones",
      details: [
        "Physique: Scarred",
        "Hair: Dyed",
        "Face: Friendly",
        "Mannerisms: On-Edge",
        "Clothing Style: Flamboyant"
      ].join("\n")
    });
  });
});
