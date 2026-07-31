import fs from "node:fs";
import { cairn } from "@devils-toys/system-cairn";
import { cwn } from "@devils-toys/system-cwn";
import { monolith } from "@devils-toys/system-monolith";
import type { SystemId } from "@devils-toys/shared";
import { projectFile } from "./paths.js";
import { tablesForSetJson } from "./table-json.js";
import { substituteTableLinks } from "./rules-substitution.js";

export const systems = { cairn, monolith, cwn } as const;

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

export function systemMarkdown(system: SystemId) {
  const source = systems[system].sourceDocuments[0];
  if (!source) throw new Error(`${systems[system].name} has no rules source.`);
  return fs.readFileSync(projectFile("raw", source.markdownFile), "utf8");
}

export function systemTablesFile(system: SystemId) {
  const source = systems[system].sourceDocuments[0];
  if (!source?.tablesFile) throw new Error(`${systems[system].name} has no sourceDocument.tablesFile.`);
  return source.tablesFile;
}

const linkedRules = new Map<SystemId, string>();

export function rulesMarkdown(system: SystemId, role: "gm" | "player") {
  let linked = linkedRules.get(system);
  if (!linked) {
    linked = substituteTableLinks(systemMarkdown(system), `system:${system}`, tablesForSetJson(systemTablesFile(system)));
    linkedRules.set(system, linked);
  }
  return role === "gm" ? linked : filterPlayerRules(linked, systems[system].gmOnlyHeadings);
}
