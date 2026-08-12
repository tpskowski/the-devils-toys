import fs from "node:fs";
import { z } from "zod";
import { cairn } from "@devils-toys/system-cairn";
import { cwn } from "@devils-toys/system-cwn";
import { monolith } from "@devils-toys/system-monolith";
import type { GameSystem, SystemId } from "@devils-toys/shared";
import { projectFile } from "./paths.js";
import { tablesForSetJson } from "./table-json.js";
import { substituteTableLinks } from "./rules-substitution.js";

/**
 * The systems compiled into this build. They are registered on start beside any
 * an admin has installed, and are otherwise ordinary members of the registry —
 * nothing may index this object to reach one.
 */
export const builtinSystems: Record<string, GameSystem> = { cairn, monolith, cwn };

/**
 * Every system this server has, built-in and installed alike. A `Map` rather
 * than an object literal because its keys are not known until the registry has
 * been read, and because a missing key should be a question you have to ask
 * rather than an `undefined` that travels.
 */
const registry = new Map<SystemId, GameSystem>(Object.entries(builtinSystems));

export function allSystems(): GameSystem[] {
  return [...registry.values()];
}

export function systemIds(): SystemId[] {
  return [...registry.keys()];
}

export function hasSystem(system: SystemId): boolean {
  return registry.has(system);
}

/** The definition, or a message naming what was asked for. */
export function systemOrThrow(system: SystemId): GameSystem {
  const definition = registry.get(system);
  if (!definition) throw new Error(`No such system: ${system}.`);
  return definition;
}

/** Registers an installed system, replacing one already held under that id. */
export function registerSystem(definition: GameSystem) {
  registry.set(definition.id, definition);
}

/** Removes an installed system. A built-in is never removed. */
export function unregisterSystem(system: SystemId) {
  if (system in builtinSystems) return false;
  return registry.delete(system);
}

/**
 * Validates a system id against what this server actually has, rather than
 * against a list compiled into it. This replaced `z.enum(SYSTEM_IDS)`, which
 * could not know about an installed system — and it is checked at request time,
 * so a system installed a minute ago is accepted without a restart.
 */
export const systemIdSchema = z.string().refine(
  (value) => registry.has(value),
  (value) => ({ message: `No such system: ${value}.` })
);

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
  const definition = systemOrThrow(system);
  const source = definition.sourceDocuments[0];
  if (!source) throw new Error(`${definition.name} has no rules source.`);
  return fs.readFileSync(projectFile("raw", source.markdownFile), "utf8");
}

export function systemTablesFile(system: SystemId) {
  const definition = systemOrThrow(system);
  const source = definition.sourceDocuments[0];
  if (!source?.tablesFile) throw new Error(`${definition.name} has no sourceDocument.tablesFile.`);
  return source.tablesFile;
}

const linkedRules = new Map<SystemId, string>();

export function rulesMarkdown(system: SystemId, role: "gm" | "player") {
  let linked = linkedRules.get(system);
  if (!linked) {
    linked = substituteTableLinks(
      systemMarkdown(system),
      `system:${system}`,
      tablesForSetJson(systemTablesFile(system))
    );
    linkedRules.set(system, linked);
  }
  return role === "gm" ? linked : filterPlayerRules(linked, systemOrThrow(system).gmOnlyHeadings);
}
