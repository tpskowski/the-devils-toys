import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { builtinSystems, isBuiltinSystem } from "./builtin-systems.js";
import { toyboxDefinition } from "./test-fixture.js";
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
  /**
   * Nothing is compiled into this build, so the repository half of the resolver
   * has no system to exercise it. A built-in is stood up for the length of these
   * tests rather than leaving that branch untested — the same arrangement
   * `systems.test.ts` uses, and for the same reason: a guard with no case to
   * catch is a guard that rots.
   */
  const compiled = "shipped-with-the-build";
  beforeAll(() => {
    builtinSystems[compiled] = toyboxDefinition();
    return () => {
      delete builtinSystems[compiled];
    };
  });

  it("comes out of the repository, not the data directory", () => {
    expect(isBuiltinSystem(compiled)).toBe(true);
    expect(systemRulesFile(compiled, "Book.md")).toBe(projectFile("raw", "Book.md"));
    expect(systemTablesJsonFile(compiled, "book.json")).toBe(projectFile("raw", "tables", "book.json"));
    expect(itemCatalogFile(compiled)).toBe(projectFile("systems", compiled, "items.json"));
    expect(traitCatalogFile(compiled)).toBe(projectFile("systems", compiled, "traits.json"));
  });

  it("does not depend on the configured data directory", () => {
    expect(systemRulesFile(compiled, "Book.md").startsWith(config.dataDir)).toBe(false);
    expect(itemCatalogFile(compiled).startsWith(config.dataDir)).toBe(false);
  });
});

describe("where an installed system's content is read from", () => {
  const installed = "toybox-2";

  it("is under the data directory, per the mutable-files constraint", () => {
    const root = path.join(config.dataDir, "systems", installed);
    expect(installedSystemRoot(installed)).toBe(root);
    expect(systemRulesFile(installed, "Toybox.md")).toBe(path.join(root, "rules", "Toybox.md"));
    expect(systemTablesJsonFile(installed, "toybox.json")).toBe(path.join(root, "tables", "toybox.json"));
    expect(itemCatalogFile(installed)).toBe(path.join(root, "items.json"));
    expect(traitCatalogFile(installed)).toBe(path.join(root, "traits.json"));
  });

  it("never reaches the repository, however the id is spelled", () => {
    for (const id of [installed, "plainbox", "thirteenth-age"]) {
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
