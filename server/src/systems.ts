import fs from "node:fs";
import { cairn } from "@devils-toys/system-cairn";
import { monolith } from "@devils-toys/system-monolith";
import type { SystemId } from "@devils-toys/shared";
import { projectFile } from "./paths.js";

export const systems = { cairn, monolith } as const;

export function filterPlayerRules(markdown: string, gmOnlyHeadings: readonly string[]) {
  const blocked = new Set(gmOnlyHeadings.map((heading) => heading.trim().toLocaleLowerCase()));
  const visible: string[] = [];
  let hiddenLevel = 0;
  for (const line of markdown.split("\n")) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) {
      const level = match[1].length;
      if (hiddenLevel && level <= hiddenLevel) hiddenLevel = 0;
      if (!hiddenLevel && blocked.has(match[2].trim().toLocaleLowerCase())) hiddenLevel = level;
    }
    if (!hiddenLevel) visible.push(line);
  }
  return visible.join("\n");
}

export function rulesMarkdown(system: SystemId, role: "gm" | "player") {
  const filename = system === "cairn" ? "Cairn.md" : "Monolith.md";
  const markdown = fs.readFileSync(projectFile("raw", filename), "utf8");
  return role === "gm" ? markdown : filterPlayerRules(markdown, systems[system].gmOnlyHeadings);
}
