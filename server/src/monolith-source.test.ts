import { describe, expect, it } from "vitest";
import { parseRollTables } from "@devils-toys/shared";
import { systemMarkdown } from "./systems.js";

describe("Monolith source tables", () => {
  const tables = parseRollTables(systemMarkdown("monolith"));
  const backgroundTables = tables.filter(
    (table) => table.category === "BACKGROUNDS" && table.section.includes("STARTING GEAR")
  );

  it("labels and classifies every character background table", () => {
    expect(backgroundTables).toHaveLength(36);
    expect(backgroundTables.every((table) => table.tags.includes("character-building"))).toBe(true);
    expect(backgroundTables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        "Mercenary - Signature Weapon",
        "Human Experiment - How Did You Escape?",
        "Bounty Hunter - A Past Complication"
      ])
    );
  });

  it("includes every compact Finishing Touches table in the roller catalogue", () => {
    expect(
      tables.filter((table) => table.category === "FINISHING TOUCHES").map((table) => [table.name, table.dice])
    ).toEqual([
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
});
