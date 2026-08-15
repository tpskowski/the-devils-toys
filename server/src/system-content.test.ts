import path from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_SYSTEM_IDS } from "@devils-toys/shared";
import { builtinSystems, isBuiltinSystem } from "./builtin-systems.js";
import { config } from "./config.js";
import { projectFile } from "./paths.js";
import {
  installedSystemRoot,
  itemCatalogFile,
  systemRulesFile,
  systemTablesJsonFile,
  traitCatalogFile
} from "./system-content.js";

describe("where a compiled system's content is read from", () => {
  // The whole point of the resolver is that it changed nothing for the three
  // systems already here. Each of these is the literal path the module it
  // replaced built, so a wrong root shows up as a failure rather than as a
  // missing file weeks later.
  it("is exactly where it was before the resolver existed", () => {
    for (const id of BUILTIN_SYSTEM_IDS) {
      const source = builtinSystems[id].sourceDocuments[0]!;
      expect(systemRulesFile(id, source.markdownFile)).toBe(projectFile("raw", source.markdownFile));
      expect(systemTablesJsonFile(id, source.tablesFile!)).toBe(projectFile("raw", "tables", source.tablesFile!));
      expect(itemCatalogFile(id)).toBe(projectFile("systems", id, "items.json"));
      expect(traitCatalogFile(id)).toBe(projectFile("systems", id, "traits.json"));
    }
  });

  it("does not depend on the configured data directory", () => {
    for (const id of BUILTIN_SYSTEM_IDS) {
      expect(systemRulesFile(id, "Book.md").startsWith(config.dataDir)).toBe(false);
      expect(itemCatalogFile(id).startsWith(config.dataDir)).toBe(false);
    }
  });
});

describe("where an installed system's content is read from", () => {
  const installed = "monolith-2";

  it("is under the data directory, per the mutable-files constraint", () => {
    const root = path.join(config.dataDir, "systems", installed);
    expect(installedSystemRoot(installed)).toBe(root);
    expect(systemRulesFile(installed, "Monolith.md")).toBe(path.join(root, "rules", "Monolith.md"));
    expect(systemTablesJsonFile(installed, "monolith.json")).toBe(path.join(root, "tables", "monolith.json"));
    expect(itemCatalogFile(installed)).toBe(path.join(root, "items.json"));
    expect(traitCatalogFile(installed)).toBe(path.join(root, "traits.json"));
  });

  it("never reaches the repository, however the id is spelled", () => {
    for (const id of [installed, "cairn-2", "thirteenth-age"]) {
      expect(isBuiltinSystem(id)).toBe(false);
      expect(systemRulesFile(id, "Book.md")).not.toContain(`${path.sep}raw${path.sep}`);
    }
  });

  it("is not confused by an id that names an inherited property", () => {
    // `Object.hasOwn`, not `in`: "constructor" and "toString" are on every
    // object literal's prototype, and reading one as a built-in would send an
    // installed system's content lookups into the repository.
    for (const id of ["constructor", "toString", "hasOwnProperty"]) {
      expect(isBuiltinSystem(id)).toBe(false);
      expect(itemCatalogFile(id).startsWith(config.dataDir)).toBe(true);
    }
  });
});
