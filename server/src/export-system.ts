/**
 * Writes a system out as a repository of its own.
 *
 * This is how a system leaves the application. It reads a registered system
 * through the same `systemContentFor` the HTTP exporter uses, so what lands on
 * disk is exactly what an install would accept — the format is not described
 * twice and cannot drift.
 *
 *   npm run systems:export -- cairn --out ../devils-toys-cairn
 *   npm run systems:export -- monolith --as monolith-2 --name "Monolith II"
 *
 * `--out` is resolved against the repository root, not the working directory, so
 * `../devils-toys-cairn` means a sibling of this checkout wherever it is run
 * from. It defaults to `../devils-toys-<id>`.
 *
 * `--as` rewrites everything namespaced by the system's id, producing a repo
 * that installs alongside its source rather than replacing it. That is the
 * scaffold for a new system and the round-trip test, in one command.
 *
 * Only the files the application owns are written. A README, a licence, notes,
 * and `.git` beside them are left exactly as they are.
 */
import path from "node:path";
import { renameSystem } from "./system-bundles.js";
import { systemContentFor } from "./system-install.js";
import { writeSystemRepoDirectory } from "./system-repo.js";
import { projectFile } from "./paths.js";
import { hasSystem, systemIds } from "./systems.js";

const args = process.argv.slice(2);

function option(name: string) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : undefined;
}

const optionNames = new Set(["out", "as", "name"]);
const positional = args.filter((arg, index) => {
  if (arg.startsWith("--")) return false;
  const previous = args[index - 1];
  return !(previous?.startsWith("--") && optionNames.has(previous.slice(2)));
});

const system = positional[0];
if (!system) throw new Error(`Name a system to export. This build has: ${systemIds().join(", ") || "none"}.`);
if (!hasSystem(system))
  throw new Error(`No such system: ${system}. This build has: ${systemIds().join(", ") || "none"}.`);

const as = option("as");
const name = option("name");
const out = option("out") ?? `../devils-toys-${as ?? system}`;
const directory = path.isAbsolute(out) ? out : projectFile(out);

const content = systemContentFor(system);
const { written, stale } = writeSystemRepoDirectory(directory, as ? renameSystem(content, as, name) : content);

console.log(`${as ?? system} → ${directory}`);
for (const file of written) console.log(`  ${file}`);
if (stale.length) {
  console.log("");
  console.log(`Left in place, no longer named by the system — remove by hand if they are finished with:`);
  for (const file of stale) console.log(`  ${file}`);
}
