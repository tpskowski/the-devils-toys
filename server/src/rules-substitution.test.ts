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

  it("leaves priced reference tables alone when they are not catalogued", () => {
    const markdown = fs.readFileSync(projectFile("raw", "Monolith.md"), "utf8");
    const tables = parseRollTables(markdown).filter((table) => table.name === "GROUP DEBT");
    const linked = substituteTableLinks(markdown, "system:monolith", tables);
    expect(linked).toContain("devils-table:system%3Amonolith/");
    expect(linked).toContain("| D6 | Old Crew Specialty |");
  });
});
