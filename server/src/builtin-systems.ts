import type { GameSystem } from "@devils-toys/shared";

/**
 * The systems compiled into this build: none.
 *
 * This application used to be a virtual tabletop *and* three game systems, with
 * Cairn, Monolith, and Cities Without Number compiled in from `systems/*` and
 * their rulebooks in `raw/`. They are repositories of their own now, installed
 * at runtime like any other. What is left here is the tabletop.
 *
 * The concept survives the systems because the distinction it draws is still
 * real, and the code that draws it is worth keeping honest: a built-in reads its
 * content from the repository, an installed one from below the data directory.
 * `system-content.ts` is the only place that asks. Should a system ever ship in
 * the image again, adding it here is the whole of the change.
 *
 * It is also what keeps the registry from being replaced out from under a system
 * that ships with the build, and what stops an uploaded bundle from shadowing
 * one. With nothing here, both are simply never true.
 */
export const builtinSystems: Record<string, GameSystem> = {};

/**
 * Whether a system's content lives in the repository rather than under the data
 * directory. This is the only thing that decides where its rules, tables, and
 * catalogues are read from.
 */
export function isBuiltinSystem(system: string): boolean {
  return Object.hasOwn(builtinSystems, system);
}
