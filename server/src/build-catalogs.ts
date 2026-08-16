/**
 * Rebuilds a system's `items.json` and `traits.json` from its own rules Markdown.
 *
 *   npm run systems:catalog -- ../devils-toys-monolith
 *   npm run systems:catalog -- fixtures/toybox
 *
 * The counterpart to `tables-md-to-json.ts --repo`: that reads a book's tables,
 * this reads its gear and the words its gear uses. Together they are everything
 * in a system repository that is generated rather than written, and both take a
 * directory so a system maintained outside this repository can be built from a
 * checkout of it. This is what `build:items` and `build:traits` did while the
 * systems lived here.
 *
 * A relative path resolves against the repository root, as `systems:export` and
 * `systems:validate` do.
 *
 * The seed is additive and the catalogue wins every id it already holds, so an
 * entry corrected by hand survives every rebuild. Run it and read the diff: what
 * appears is what the book has gained.
 *
 * The system is installed into a throwaway data directory first, because that is
 * the only way its content resolves — an installed system's files are read from
 * below the data directory, and nothing here is special-cased. Building through
 * the real install path means a repository this accepts is one the server would
 * accept too.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "devils-toys-catalog-"));
process.env.DEVILS_TOYS_DATA_DIR = dataDir;

// Imported after the data directory is set, because `config.ts` reads it once.
const { readSystemRepoDirectory } = await import("./system-repo.js");
const { writeSystemBundle } = await import("./system-install.js");
const { registerSystem } = await import("./systems.js");
const { seedItemCatalog, writeItemCatalog } = await import("./item-catalog.js");
const { seedTraitCatalog, writeTraitCatalog } = await import("./trait-catalog.js");
const { projectFile } = await import("./paths.js");

const target = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
if (!target) throw new Error("Name a system repository directory to build the catalogues of.");
const directory = path.isAbsolute(target) ? target : projectFile(target);

try {
  const repo = readSystemRepoDirectory(directory);
  writeSystemBundle(repo);
  registerSystem(repo.system);
  const system = repo.system.id;

  // Seeding reads and writes through the installed copy, so the results are
  // copied back into the repository the caller actually named.
  const items = seedItemCatalog(system);
  const traits = seedTraitCatalog(system);
  writeItemCatalog(system, items.catalog);
  writeTraitCatalog(system, traits.catalog);
  fs.copyFileSync(path.join(dataDir, "systems", system, "items.json"), path.join(directory, "items.json"));
  fs.copyFileSync(path.join(dataDir, "systems", system, "traits.json"), path.join(directory, "traits.json"));

  const gear = Object.values(items.catalog.lists).flat();
  console.log(`${repo.system.name} → ${directory}`);
  console.log(`  items    ${gear.length} total, ${items.added.length} added`);
  console.log(`  traits   ${traits.catalog.traits.length} total, ${traits.added.length} added`);
  for (const id of [...items.added, ...traits.added]) console.log(`    + ${id}`);
  // Never removed, only reported: an entry the book stopped offering is either a
  // deliberate addition or a rename, and neither is ours to delete.
  for (const id of [...items.unmatched, ...traits.unmatched]) console.log(`    ? ${id} — not in the book, kept`);
} finally {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Reading the catalogues opens the database, and Windows keeps that file
    // locked until the process exits. A temporary directory left behind must
    // never fail a build that has already written what it came to write.
  }
}
