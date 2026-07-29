import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRollTables, rowForRoll } from "@devils-toys/shared";
import { npcCatalog } from "./npcs.js";
import { projectFile } from "./paths.js";
import { rulesMarkdown, systemMarkdown } from "./systems.js";

const canonical = fs.readFileSync(projectFile("raw", "CitiesWithoutNumberSRDv1.0.html"), "utf8");
const markdown = systemMarkdown("cwn");
const corrections = fs.readFileSync(projectFile("raw", "citieswithoutnumber-corrections.md"), "utf8");

describe("Cities Without Number source import", () => {
  it("repairs the canonical duplicate numbering and records both changes", () => {
    expect(canonical).toContain("1.7.5 Choose Starting Languages");
    expect(canonical).toContain("1.7.5 Choose Starting Gear");
    expect(canonical).toContain("1.7.6 Choose a Name and Goal");

    expect(markdown).toContain("### 1.7.5 Choose Starting Languages");
    expect(markdown).toContain("### 1.7.6 Choose Starting Gear");
    expect(markdown).toContain("### 1.7.7 Choose a Name and Goal");
    expect(corrections).toContain("`1.7.6 Choose Starting Gear`");
    expect(corrections).toContain("`1.7.7 Choose a Name and Goal`");
    expect(corrections).toContain("No wording repairs have been made.");
  });

  it("has unique numbering and heading levels that match every numbered section", () => {
    const numbered = markdown
      .split("\n")
      .map((line) => /^(#{1,6})\s+(.+)$/.exec(line))
      .filter((match): match is RegExpExecArray => Boolean(match))
      .map((match) => {
        const number = /(\d+(?:\.\d+)+)/.exec(match[2])?.[1];
        return number ? { level: match[1].length, number } : undefined;
      })
      .filter((entry): entry is { level: number; number: string } => Boolean(entry));

    expect(new Set(numbered.map((entry) => entry.number)).size).toBe(numbered.length);
    for (const entry of numbered) {
      const parts = entry.number.split(".").map(Number);
      while (parts.length > 1 && parts.at(-1) === 0) parts.pop();
      expect(entry.level, entry.number).toBe(parts.length);
    }
  });

  it("preserves repaired section hierarchy in the runtime Markdown", () => {
    expect(markdown).toContain("### 1.6.1 Focus List");
    expect(markdown).toContain("### 2.6.1 Foot Chases");
    expect(markdown).toContain("### 2.6.2 Vehicle Chases");
    expect(markdown).toContain("# 3.0.0 Gear, Vehicles, and Cyberware");
    expect(markdown).toContain("## 3.1.0 Mission Gear");
    expect(markdown).toContain("#### 6.1.3.5 Spell List");
    expect(markdown).toContain("#### 6.2.3.2 Immediate Spirit Summonings");
    expect(markdown).toContain("### 6.2.8 Spirit Powers");
  });

  it("extracts the repaired source tables, including modifier-aware 2d6 rows", () => {
    const tables = parseRollTables(markdown);
    expect(tables).toHaveLength(44);
    expect(tables.filter((table) => table.tags.includes("character-building"))).toHaveLength(40);

    const reaction = tables.find((table) => table.name === "5.1.0 Reaction Rolls");
    expect(reaction).toMatchObject({ dice: "2d6", tags: ["random-encounter"] });
    expect(rowForRoll(reaction!, -4)?.label).toBe("2-");
    expect(rowForRoll(reaction!, 14)?.label).toBe("12+");
  });

  it("exposes individual antagonist stat blocks only to GMs", () => {
    expect(npcCatalog("cwn")).toHaveLength(26);
    expect(npcCatalog("cwn").map((entry) => entry.name)).toContain("Experimental Bioweapon");

    const playerRules = rulesMarkdown("cwn", "player");
    expect(playerRules).not.toContain("Experimental Bioweapon");
    expect(playerRules).toContain("4.0.0 Hacking");
    expect(playerRules).toContain("6.0.0 Magic");
  });
});
