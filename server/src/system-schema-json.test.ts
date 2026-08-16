import fs from "node:fs";
import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import { SCHEMA_FILE, buildSystemJsonSchema, renderSystemJsonSchema } from "./system-schema-json.js";
import { toyboxDefinition } from "./test-fixture.js";
import { projectFile } from "./paths.js";

/**
 * The published schema is a copy of `gameSystemSchema` in a form an author's
 * editor can read. A copy is only worth having while it says the same thing as
 * the original, which is what the first test is for — and only worth publishing
 * if it actually catches a mistake, which is what the rest are for.
 */
const validator = () => new Ajv({ strict: false, allErrors: true }).compile(buildSystemJsonSchema());

describe("the published system schema", () => {
  it("is what this build would generate, so it cannot drift from the Zod it came from", () => {
    expect(fs.existsSync(SCHEMA_FILE)).toBe(true);
    expect(fs.readFileSync(SCHEMA_FILE, "utf8")).toBe(renderSystemJsonSchema());
  });

  it("accepts the systems this repository has", () => {
    const validate = validator();
    for (const fixture of ["toybox", "plainbox"]) {
      const system = JSON.parse(fs.readFileSync(projectFile("fixtures", fixture, "system.json"), "utf8"));
      expect(validate(system), `${fixture}: ${JSON.stringify(validate.errors?.[0])}`).toBe(true);
    }
  });

  it("refuses an id no server could install", () => {
    const validate = validator();
    expect(validate({ ...toyboxDefinition(), id: "Toybox" })).toBe(false);
  });

  it("refuses a theme this application does not ship", () => {
    const validate = validator();
    expect(validate({ ...toyboxDefinition(), defaultTheme: "chartreuse" })).toBe(false);
  });

  it("refuses a key it does not know, as the strict Zod objects do", () => {
    const validate = validator();
    expect(validate({ ...toyboxDefinition(), somethingInvented: true })).toBe(false);
  });

  it("refuses a system with no source document", () => {
    const validate = validator();
    expect(validate({ ...toyboxDefinition(), sourceDocuments: [] })).toBe(false);
  });
});
