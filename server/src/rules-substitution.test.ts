import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRollTables } from "@devils-toys/shared";
import { projectFile } from "./paths.js";
import { substituteTableLinks } from "./rules-substitution.js";

describe("rules table substitution", () => {
  it("replaces catalogued tables and is idempotent", () => {
    const markdown = `# Rules\n\n### Omens (d6)\n\n| d6 | Result |\n| --- | --- |\n| 1 | Rain |\n`;
    const [table] = parseRollTables(markdown);
    const linked = substituteTableLinks(markdown, "system:test", [table]);
    expect(linked).toContain("devils-table:system%3Atest/");
    expect(linked).not.toContain("| d6 | Result |");
    expect(substituteTableLinks(linked, "system:test", [table])).toBe(linked);
  });

  it("leaves reference tables alone when they are not catalogued", () => {
    const markdown = fs.readFileSync(projectFile("fixtures", "toybox", "rules", "Toybox.md"), "utf8");
    // One table of the fixture's five is catalogued. The other four are left in
    // the text exactly as they are, which is the whole point: substitution is
    // driven by the catalogue, not by "this looks like a table".
    const tables = parseRollTables(markdown).filter((table) => table.name.startsWith("Weather"));
    const linked = substituteTableLinks(markdown, "system:toybox", tables);
    expect(linked).toContain("devils-table:system%3Atoybox/");
    expect(linked).not.toContain("| d6 | Sky | Wind | Underfoot |");
    expect(linked).toContain("| d10 | Complication |");
  });
});
