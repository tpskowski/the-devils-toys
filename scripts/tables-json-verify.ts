import fs from "node:fs";
import path from "node:path";
import { parseSet } from "./table-json-lib.ts";

const input = process.argv[process.argv.indexOf("--in") + 1];
const jsonPath = process.argv[process.argv.indexOf("--json") + 1];
if (!input || !jsonPath) throw new Error("Use --in <markdown> --json <document>.");

const document = JSON.parse(fs.readFileSync(path.resolve(jsonPath), "utf8"));
const parsed = parseSet(fs.readFileSync(path.resolve(input), "utf8"), { setName: document.setName ?? "Imported" });
if (parsed.tables.length !== document.tables?.length) throw new Error("JSON table count differs from Markdown.");
for (let index = 0; index < parsed.tables.length; index += 1) {
  const expected = parsed.tables[index];
  const actual = document.tables[index];
  const comparable = (table: typeof expected) => {
    const { origin: _origin, classification: _classification, ...rest } = table;
    return rest;
  };
  if (JSON.stringify(comparable(expected)) !== JSON.stringify(comparable(actual))) {
    throw new Error(`Table ${index} differs from the Markdown parse.`);
  }
  for (const row of actual.rows) {
    if (row.min > row.max) throw new Error(`Table ${actual.id} has an inverted row range.`);
  }
}
