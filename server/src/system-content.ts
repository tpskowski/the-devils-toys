import path from "node:path";
import type { SystemId } from "@devils-toys/shared";
import { config } from "./config.js";
import { isBuiltinSystem } from "./builtin-systems.js";
import { projectFile } from "./paths.js";

/**
 * Where a system's content is read from.
 *
 * There are two roots and one rule. A compiled system's rules and tables live
 * in `raw/` and its catalogues beside its package, exactly as they always have;
 * nothing about a built-in moves. An installed system's content lives under the
 * configured data directory, per the standing constraint that mutable files stay
 * below it — it arrived at runtime, so it is data, not part of the image.
 *
 * Every read of a system's content goes through here, so that the question
 * "where does this come from" is asked in one place rather than answered by
 * whichever module happened to be reading.
 */

/** The directory an installed system's bundle was unpacked into. */
export function installedSystemRoot(system: SystemId) {
  return path.join(config.dataDir, "systems", system);
}

/** A system's authoritative rules Markdown. */
export function systemRulesFile(system: SystemId, markdownFile: string) {
  return isBuiltinSystem(system)
    ? projectFile("raw", markdownFile)
    : path.join(installedSystemRoot(system), "rules", markdownFile);
}

/** A system's extracted table set. */
export function systemTablesJsonFile(system: SystemId, tablesFile: string) {
  return isBuiltinSystem(system)
    ? projectFile("raw", "tables", tablesFile)
    : path.join(installedSystemRoot(system), "tables", tablesFile);
}

/**
 * A system's gear. A built-in's sits beside the package that owns it, which is
 * also what `@devils-toys/system-<id>/items` resolves to and what esbuild
 * inlines into the bundle; this path is what the catalogue build scripts write.
 */
export function itemCatalogFile(system: SystemId) {
  return isBuiltinSystem(system)
    ? projectFile("systems", system, "items.json")
    : path.join(installedSystemRoot(system), "items.json");
}

/** What a system's weapon words mean. See `itemCatalogFile`. */
export function traitCatalogFile(system: SystemId) {
  return isBuiltinSystem(system)
    ? projectFile("systems", system, "traits.json")
    : path.join(installedSystemRoot(system), "traits.json");
}
