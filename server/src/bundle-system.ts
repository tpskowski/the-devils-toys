/**
 * Builds an installable .devilsystem.zip straight from a system repository.
 *
 * This is the local-development path: it reads the same repository shape as a
 * network install, runs the same install checks as `systems:validate`, and uses
 * the same bundle writer as the server's Export button.
 *
 *   npm run systems:bundle -- ../devils-toys-monolith
 *   npm run systems:bundle -- ../devils-toys-monolith --out ../devils-toys-monolith/dist/monolith.devilsystem.zip
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "devils-toys-bundle-"));
process.env.DEVILS_TOYS_DATA_DIR = scratch;

// These imports reach the database through the install checks, so they must be
// loaded only after the live data directory has been replaced with scratch.
const { buildSystemBundle, readSystemBundle } = await import("./system-bundles.js");
const { refuseUninstallableBundle, refuseUninstallableCreation, verifySystemTables } =
  await import("./system-install.js");
const { readSystemRepoDirectory } = await import("./system-repo.js");
const { projectFile } = await import("./paths.js");

const args = process.argv.slice(2);

function option(name: string) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : undefined;
}

const optionNames = new Set(["out"]);
const positional = args.filter((argument, index) => {
  if (argument.startsWith("--")) return false;
  const previous = args[index - 1];
  return !(previous?.startsWith("--") && optionNames.has(previous.slice(2)));
});

try {
  const target = positional[0];
  if (!target) throw new Error("Name a system repository directory to bundle.");

  const directory = path.isAbsolute(target) ? target : projectFile(target);
  const repo = readSystemRepoDirectory(directory);

  refuseUninstallableBundle(repo);
  refuseUninstallableCreation(repo);
  verifySystemTables(repo.system.id, repo.system, repo.tables);

  const requestedOut = option("out");
  const output = requestedOut
    ? path.isAbsolute(requestedOut)
      ? requestedOut
      : projectFile(requestedOut)
    : path.join(directory, `${repo.system.id}.devilsystem.zip`);
  if (!output.endsWith(".devilsystem.zip")) throw new Error("The bundle output must end in .devilsystem.zip.");

  const archive = buildSystemBundle(repo, repo.marker);
  // Read the bytes back before writing them so this command cannot emit an
  // archive that the file installer itself would refuse.
  readSystemBundle(archive);

  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = `${output}.tmp`;
  fs.writeFileSync(temporary, archive);
  fs.renameSync(temporary, output);

  console.log(`${repo.system.name} (${repo.system.id}) → ${output}`);
  console.log(`  version      ${repo.marker.version || "unversioned"}`);
  console.log(`  breaking     ${repo.marker.breaking ? "yes" : "no"}`);
  console.log(`  size         ${archive.byteLength.toLocaleString()} bytes`);
} finally {
  try {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows may keep the throwaway database open until this process exits.
  }
}
