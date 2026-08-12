import type { GameSystem } from "@devils-toys/shared";
import { cairn } from "@devils-toys/system-cairn";
import { cwn } from "@devils-toys/system-cwn";
import { monolith } from "@devils-toys/system-monolith";

/**
 * The systems compiled into this build.
 *
 * Kept apart from the registry in `systems.ts` so that `system-content.ts` can
 * ask whether a system is one of these without importing the registry, which
 * imports the resolver in turn. It is also the honest shape of the thing: what
 * ships in the image is a different question from what this server has.
 */
export const builtinSystems: Record<string, GameSystem> = { cairn, monolith, cwn };

/**
 * Whether a system's content lives in the repository rather than under the data
 * directory. This is the only thing that decides where its rules, tables, and
 * catalogues are read from.
 */
export function isBuiltinSystem(system: string): boolean {
  return Object.hasOwn(builtinSystems, system);
}
