import { zodToJsonSchema } from "zod-to-json-schema";
import { gameSystemSchema } from "./system-schema.js";
import { SYSTEM_REPO_VERSION } from "./system-repo.js";
import { projectFile } from "./paths.js";

/**
 * The system schema, as JSON Schema.
 *
 * `gameSystemSchema` is the authority on what a system may say about itself, and
 * it is written in Zod because Zod is what validates an install. A system lives
 * in its own repository now, though, and its author has no way to run this
 * application's Zod against the file they are editing. This is that same schema
 * in a form an editor and a CI job can read.
 *
 * Nothing here has a side effect — `build-schema.ts` is the command that writes
 * the file, and the route that serves it must be able to import the path without
 * rewriting anything.
 */

export const SCHEMA_FILE = projectFile("schema", `devilsystem-${SYSTEM_REPO_VERSION}.schema.json`);

export function buildSystemJsonSchema() {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: `https://raw.githubusercontent.com/tpskowski/the-devils-toys/main/schema/devilsystem-${SYSTEM_REPO_VERSION}.schema.json`,
    title: "The Devil's Toys game system",
    description:
      "The contents of a system repository's system.json. Generated from the Zod schema the server validates an install with; do not edit by hand.",
    ...zodToJsonSchema(gameSystemSchema, { target: "jsonSchema7", $refStrategy: "none" })
  };
}

export function renderSystemJsonSchema() {
  return `${JSON.stringify(buildSystemJsonSchema(), null, 2)}\n`;
}
