import { describe, expect, it } from "vitest";
import { parseRollTables } from "@devils-toys/shared";
import { systemMarkdown } from "./systems.js";

describe("Monolith source tables", () => {
  const backgroundTables = parseRollTables(systemMarkdown("monolith")).filter(
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
});
