/**
 * Checks a system the way a server would, without a server.
 *
 * Every refusal an install can produce is produced here instead, against a
 * working copy, so an author finds out about a bad field while they are looking
 * at it rather than after pushing. It is the same three checks the install route
 * runs, in the same order, on the same validated shape.
 *
 *   npm run systems:validate -- ../devils-toys-cairn
 *   npm run systems:validate -- ./cairn.devilsystem.zip
 *
 * A relative path is resolved against the repository root, not the working
 * directory, so `../devils-toys-cairn` means a sibling of this checkout wherever
 * it is run from — the same rule `systems:export` follows. This is also what a
 * system repository's own CI calls, with this repository checked out beside it.
 *
 * It reads nothing but the system it was pointed at, and writes nothing at all.
 * That takes saying, because the checks reach `item-catalog`, which reaches
 * `character-items`, which reaches `room-items`, which opens the database — so
 * merely importing them would open, and migrate, whatever `DEVILS_TOYS_DATA_DIR`
 * names. That is somebody's live server. A throwaway directory is put in its
 * place below, before anything on that chain is loaded.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "devils-toys-validate-"));
process.env.DEVILS_TOYS_DATA_DIR = scratch;

// Imported after the data directory is redirected, because `config.ts` reads it
// once and the database is opened as a side effect of loading these.
const { readSystemBundle } = await import("./system-bundles.js");
const { refuseUninstallableBundle, verifySystemTables } = await import("./system-install.js");
const { readSystemRepoDirectory } = await import("./system-repo.js");
const { projectFile } = await import("./paths.js");

try {
  const target = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
  if (!target) throw new Error("Name a system repository directory or a .devilsystem.zip to validate.");

  const resolved = path.isAbsolute(target) ? target : projectFile(target);
  if (!fs.existsSync(resolved)) throw new Error(`There is nothing at ${resolved}.`);

  const content = fs.statSync(resolved).isDirectory()
    ? readSystemRepoDirectory(resolved)
    : readSystemBundle(fs.readFileSync(resolved));

  refuseUninstallableBundle(content);
  verifySystemTables(content.system.id, content.system, content.tables);

  const { system, items, traits, rules, tables } = content;
  const itemCount = Object.values(items.lists).flat().length;
  const traitCount = traits.traits.length;
  const licenses = [...new Set(system.sourceDocuments.map((document) => document.license))];

  console.log(`${system.name} (${system.id}) — valid`);
  console.log(`  licence      ${licenses.join(", ")}`);
  console.log(
    `  sheet        ${system.characterSheet.sections.length} sections, ${system.characterSheet.lists.length} lists`
  );
  console.log(`  content      ${system.contentModules.length} modules over ${system.sourceDocuments.length} documents`);
  console.log(`  rules        ${Object.keys(rules).join(", ")}`);
  console.log(`  tables       ${Object.keys(tables).join(", ")}`);
  console.log(`  catalogues   ${itemCount} items, ${traitCount} traits`);
} finally {
  try {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows keeps the database file locked until the process exits. A leftover
    // temporary directory must not fail a validation that already answered.
  }
}
