/**
 * Seeds a system's `items.json` from its rulebook, once.
 *
 * The catalogue is the authority; the book only ever starts it off. A system
 * whose file already holds entries is left completely alone — running this
 * cannot touch, reorder, or reinstate anything, so gear that has been corrected,
 * rebalanced, invented, or retired stays exactly as its author left it.
 *
 * To fold in entries a book has gained since — a corrections file, a new
 * printing — run it with `--merge`. That pass is still additive only: existing
 * entries keep every value they carry, and a retired id is never brought back.
 *
 * To rebuild from the book from scratch, discarding every hand edit in it,
 * delete the file first and run this again.
 *
 *   npm run build:items         seed any system that has no catalogue yet
 *   npm run build:items:merge   fold in what the books have gained
 *
 * To narrow a merge to one system, run it in the server workspace directly:
 * `npm run build:items --workspace @devils-toys/server -- --merge cwn`.
 */
import fs from "node:fs";
import { BUILTIN_SYSTEM_IDS, type SystemId } from "@devils-toys/shared";
import { itemCatalogFile, readItemCatalog, seedItemCatalog, writeItemCatalog } from "./item-catalog.js";

const args = process.argv.slice(2);
const merge = args.includes("--merge");
const named = args.filter((arg) => !arg.startsWith("--"));
const unknown = named.filter((arg) => !(BUILTIN_SYSTEM_IDS as readonly string[]).includes(arg));
if (unknown.length)
  throw new Error(`No such system: ${unknown.join(", ")}. Try one of ${BUILTIN_SYSTEM_IDS.join(", ")}.`);
const chosen = (named.length ? named : BUILTIN_SYSTEM_IDS) as readonly SystemId[];

for (const system of chosen) {
  const seeded =
    fs.existsSync(itemCatalogFile(system)) && Object.values(readItemCatalog(system).lists).flat().length > 0;
  if (seeded && !merge) {
    const total = Object.values(readItemCatalog(system).lists).flat().length;
    console.log(
      `${system}: ${total} items, already seeded — untouched. Use --merge to fold in what the book has gained.`
    );
    continue;
  }

  const { catalog, added, unmatched } = seedItemCatalog(system);
  const total = Object.values(catalog.lists).flat().length;
  const written = writeItemCatalog(system, catalog);
  const summary = added.length ? `${added.length} added` : written ? "rewritten" : "unchanged";
  console.log(`${system}: ${total} items, ${summary}`);
  for (const id of added) console.log(`  + ${id}`);
  if (catalog.retired?.length)
    console.log(`  ${catalog.retired.length} retired, never re-offered: ${catalog.retired.join(", ")}`);
  if (unmatched.length) {
    console.log(`  ${unmatched.length} in the catalogue but not in the book today, left untouched:`);
    for (const id of unmatched) console.log(`    ? ${id}`);
  }
}
