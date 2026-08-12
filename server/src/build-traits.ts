/**
 * Seeds a system's `traits.json` from its rulebook, once. Same contract as
 * `build-items`: a catalogue that already holds definitions is left completely
 * alone, so a trait corrected or written in by hand stays that way.
 *
 *   npm run build:traits         seed any system that has none yet
 *   npm run build:traits:merge   fold in definitions the books have gained
 *
 * To narrow a merge to one system, run it in the server workspace directly:
 * `npm run build:traits --workspace @devils-toys/server -- --merge cwn`.
 */
import fs from "node:fs";
import { BUILTIN_SYSTEM_IDS, type SystemId } from "@devils-toys/shared";
import { readTraitCatalog, seedTraitCatalog, traitCatalogFile, writeTraitCatalog } from "./trait-catalog.js";

const args = process.argv.slice(2);
const merge = args.includes("--merge");
const named = args.filter((arg) => !arg.startsWith("--"));
const unknown = named.filter((arg) => !(BUILTIN_SYSTEM_IDS as readonly string[]).includes(arg));
if (unknown.length)
  throw new Error(`No such system: ${unknown.join(", ")}. Try one of ${BUILTIN_SYSTEM_IDS.join(", ")}.`);
const chosen = (named.length ? named : BUILTIN_SYSTEM_IDS) as readonly SystemId[];

for (const system of chosen) {
  const seeded = fs.existsSync(traitCatalogFile(system)) && readTraitCatalog(system).traits.length > 0;
  if (seeded && !merge) {
    console.log(
      `${system}: ${readTraitCatalog(system).traits.length} traits, already seeded — untouched. Use --merge to fold in what the book has gained.`
    );
    continue;
  }

  const { catalog, added, unmatched } = seedTraitCatalog(system);
  const written = writeTraitCatalog(system, catalog);
  const summary = added.length ? `${added.length} added` : written ? "rewritten" : "unchanged";
  console.log(`${system}: ${catalog.traits.length} traits, ${summary}`);
  for (const id of added) console.log(`  + ${id}`);
  if (unmatched.length) console.log(`  ${unmatched.length} written by hand, left untouched: ${unmatched.join(", ")}`);
}
