import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { monolith } from "@devils-toys/system-monolith";
import { rollHirelingCreation } from "./hireling-creation.js";
import { projectFile } from "./paths.js";
import { parseCompactRollTables } from "./roll-tables.js";

const markdown = fs.readFileSync(projectFile("raw", "Monolith.md"), "utf8");
const definition = monolith.groupPage!.hirelings!.creationRoll!;

describe("Monolith freelancer creation", () => {
  it("reads every Finishing Touches table from the authoritative Markdown", () => {
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
    expect(rollHirelingCreation(definition, markdown, () => 0)).toEqual({
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
    expect(rollHirelingCreation(definition, markdown, () => 0.999)).toMatchObject({
      strCurrent: 18,
      strMax: 18,
      dexCurrent: 18,
      dexMax: 18,
      wilCurrent: 18,
      wilMax: 18,
      hpCurrent: 6,
      hpMax: 6,
      name: "Juda Bones",
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
