import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { projectFile } from "./paths.js";
import { characterVicesFor } from "./character-vices.js";
import { installToybox } from "./test-fixture.js";

installToybox();

/**
 * A vice catalogue is one table, found by the name of its first column. Both
 * ways of getting at it are covered: straight from a book's Markdown, and from
 * the table JSON a system's repository committed.
 */
const drink = { name: "Drink", triggers: "Idleness", satisfying: "A full night and a full purse" };

describe("character vices", () => {
  it("retains every informative column from the source table", () => {
    const markdown = fs.readFileSync(projectFile("fixtures", "toybox", "rules", "Toybox.md"), "utf8");
    const vices = characterVicesFor(markdown, "Vice");
    expect(vices).toHaveLength(6);
    expect(vices[0]).toEqual(drink);
  });

  it("reads a registered system's vice catalogue from its generated table JSON", () => {
    const vices = characterVicesFor("toybox");
    expect(vices).toHaveLength(6);
    expect(vices).toEqual(expect.arrayContaining([drink, expect.objectContaining({ name: "Gambling" })]));
  });
});
