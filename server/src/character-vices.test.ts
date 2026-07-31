import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { projectFile } from "./paths.js";
import { characterVicesFor } from "./character-vices.js";

describe("Monolith character vices", () => {
  it("retains every informative column from the source table", () => {
    const vices = characterVicesFor(fs.readFileSync(projectFile("raw", "Monolith.md"), "utf8"));
    expect(vices).toHaveLength(10);
    expect(vices[0]).toEqual({
      name: "Gambling",
      triggers: "Major win or loss at a high stakes game or wager.",
      satisfying:
        "Gamble with at least 10% of your personal wealth, wager a unique/ useful/powerful item, put other major stakes up."
    });
  });
});
