/**
 * Writes the system schema out as JSON Schema.
 *
 *   npm run systems:schema            regenerate the published file
 *   npm run systems:schema -- --check assert it is current, and write nothing
 *
 * Generated, never hand-edited. It is committed so a system repository can point
 * at a stable URL, and checked so it cannot drift from the Zod it came from:
 * change `system-schema.ts`, run this, commit the result.
 */
import fs from "node:fs";
import { SCHEMA_FILE, renderSystemJsonSchema } from "./system-schema-json.js";
import { projectFile } from "./paths.js";

const rendered = renderSystemJsonSchema();

if (process.argv.includes("--check")) {
  const existing = fs.existsSync(SCHEMA_FILE) ? fs.readFileSync(SCHEMA_FILE, "utf8") : "";
  if (existing !== rendered)
    throw new Error(
      `${SCHEMA_FILE} is out of date with system-schema.ts. Regenerate it with 'npm run systems:schema'.`
    );
  console.log("The published schema matches the one the server validates with.");
} else {
  fs.mkdirSync(projectFile("schema"), { recursive: true });
  fs.writeFileSync(SCHEMA_FILE, rendered);
  console.log(`${SCHEMA_FILE} — ${rendered.length} bytes`);
}
