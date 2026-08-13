import { describe, expect, it } from "vitest";
import { strToU8, zipSync, unzipSync, strFromU8 } from "fflate";
import { builtinSystems } from "./builtin-systems.js";
import { buildSystemBundle, readSystemBundle, renameSystem, type SystemBundleContent } from "./system-bundles.js";
import { systemContentFor } from "./system-install.js";

/** Monolith, read off disk exactly as an export would read it. */
const monolithContent = () => systemContentFor("monolith");

const bundleOf = (content: SystemBundleContent) => readSystemBundle(buildSystemBundle(content));

describe("a system bundle", () => {
  it("carries a compiled system out and back unchanged", () => {
    const content = monolithContent();
    const read = bundleOf(content);

    expect(read.system).toEqual(JSON.parse(JSON.stringify(content.system)));
    expect(read.items).toEqual(content.items);
    expect(read.traits).toEqual(content.traits);
    expect(read.rules).toEqual(content.rules);
    expect(read.tables).toEqual(content.tables);
  });

  it("carries every compiled system, not just the one it was written for", () => {
    for (const id of Object.keys(builtinSystems)) {
      const content = systemContentFor(id);
      expect(bundleOf(content).system).toEqual(JSON.parse(JSON.stringify(content.system)));
    }
  });

  it("records the licences its source documents state", () => {
    const archive = unzipSync(buildSystemBundle(monolithContent()));
    const manifest = JSON.parse(strFromU8(archive["manifest.json"]));
    expect(manifest.app).toBe("devils-toys-system");
    expect(manifest.systemId).toBe("monolith");
    expect(manifest.licenses).toEqual(["CC BY-SA 4.0"]);
  });

  it("puts the rules and tables where the layout says", () => {
    const names = Object.keys(unzipSync(buildSystemBundle(monolithContent()))).sort();
    expect(names).toEqual([
      "items.json",
      "manifest.json",
      "rules/Monolith.md",
      "rules/corrections.md",
      "system.json",
      "tables/monolith.json",
      "traits.json"
    ]);
  });
});

describe("renaming a system for a bundle", () => {
  const renamed = () => renameSystem(monolithContent(), "monolith-2", "Monolith (installed)");

  it("moves all five things namespaced by the id, and nothing else", () => {
    const before = monolithContent();
    const after = renamed();

    expect(after.system.id).toBe("monolith-2");
    expect(after.system.name).toBe("Monolith (installed)");
    expect(after.system.contentModules.map((module) => module.id)).toEqual(["monolith-2/core", "monolith-2/gm"]);
    expect(after.system.contentModules.map((module) => module.storageNamespace)).toEqual([
      "monolith-2.core",
      "monolith-2.gm"
    ]);
    // The dependency between the two modules has to move with their ids, or the
    // GM module requires something that no longer exists.
    expect(after.system.contentModules[1].requires).toEqual(["monolith-2/core"]);
    expect(after.system.contentModules[1].provides).toEqual(["monolith-2/gm"]);
    expect(after.items.system).toBe("monolith-2");
    expect(after.traits.system).toBe("monolith-2");

    // Everything that is not an identifier is left exactly as it was.
    expect(after.rules).toEqual(before.rules);
    expect(after.tables).toEqual(before.tables);
    expect(after.system.characterSheet).toEqual(before.system.characterSheet);
    expect(after.system.dice).toEqual(before.system.dice);
    expect(after.system.warningRules).toEqual(before.system.warningRules);
  });

  it("renames every item id, so none of them claims the wrong system", () => {
    const after = renamed();
    const ids = Object.values(after.items.lists)
      .flat()
      .map((item) => item.id);
    expect(ids.length).toBeGreaterThan(50);
    expect(ids.every((id) => id.startsWith("monolith-2/"))).toBe(true);
    expect(ids.some((id) => id.startsWith("monolith/"))).toBe(false);
    for (const id of after.items.retired ?? []) expect(id.startsWith("monolith-2/")).toBe(true);
  });

  it("leaves a capability namespace that is not the system's own alone", () => {
    // CWN's modules provide "without-number/core@1", which is a family rather
    // than this system. Renaming the system must not touch it.
    const after = renameSystem(systemContentFor("cwn"), "cwn-2");
    expect(after.system.contentModules.map((module) => module.id)).toContain("cwn-2/cyberware");
    expect(after.system.contentModules.find((module) => module.id === "cwn-2/cyberware")?.provides).toEqual([
      "without-number/cyberware@1"
    ]);
    expect(after.system.contentModules.find((module) => module.id === "cwn-2/cyberware")?.requires).toEqual([
      "without-number/core@1"
    ]);
  });

  it("produces a bundle that reads back as the renamed system", () => {
    const read = bundleOf(renamed());
    expect(read.system.id).toBe("monolith-2");
    expect(read.manifest.systemId).toBe("monolith-2");
    expect(read.items.system).toBe("monolith-2");
  });

  it("refuses an id it could not write to disk", () => {
    for (const id of ["Monolith2", "../escape", "monolith 2", ""])
      expect(() => renameSystem(monolithContent(), id)).toThrow(/not a usable system id/);
  });
});

describe("reading a bundle that is not one", () => {
  const bytes = () => buildSystemBundle(renameSystem(monolithContent(), "monolith-2"));

  const rebuilt = (change: (files: Record<string, Uint8Array>) => void) => {
    const files = unzipSync(bytes());
    change(files);
    return zipSync(files);
  };

  it("refuses something that is not a zip at all", () => {
    expect(() => readSystemBundle(strToU8("not a zip"))).toThrow(/not a readable zip archive/);
  });

  it("refuses an archive with no manifest", () => {
    expect(() => readSystemBundle(zipSync({ "system.json": strToU8("{}") }))).toThrow(/no manifest\.json/);
  });

  it("refuses an archive written by something else", () => {
    expect(() =>
      readSystemBundle(rebuilt((files) => (files["manifest.json"] = strToU8('{"app":"devils-tables","sets":[]}'))))
    ).toThrow(/not written as a system bundle/);
  });

  it("refuses a bundle from a newer version of this application", () => {
    expect(() =>
      readSystemBundle(
        rebuilt((files) => {
          const manifest = JSON.parse(strFromU8(files["manifest.json"]));
          manifest.bundleVersion = 99;
          files["manifest.json"] = strToU8(JSON.stringify(manifest));
        })
      )
    ).toThrow(/newer version \(99\)/);
  });

  it("refuses a manifest missing its bundle version", () => {
    expect(() =>
      readSystemBundle(
        rebuilt((files) => {
          const manifest = JSON.parse(strFromU8(files["manifest.json"]));
          delete manifest.bundleVersion;
          files["manifest.json"] = strToU8(JSON.stringify(manifest));
        })
      )
    ).toThrow(/manifest\.json is not a valid system bundle manifest/);
  });

  it("refuses an entry that would write outside the bundle", () => {
    for (const escape of ["../evil.js", "rules/../../evil.md", "/etc/passwd", "C:/windows/evil.txt"])
      expect(() => readSystemBundle(rebuilt((files) => (files[escape] = strToU8("x"))))).toThrow(
        /would write outside it|not one of the files/
      );
  });

  it("checks directory entries for path traversal too", () => {
    expect(() => readSystemBundle(rebuilt((files) => (files["../escape/"] = strToU8(""))))).toThrow(
      /would write outside it/
    );
  });

  it("refuses a file a system bundle has no place for", () => {
    expect(() => readSystemBundle(rebuilt((files) => (files["install.sh"] = strToU8("rm -rf /"))))).toThrow(
      /not one of the files a system bundle may carry/
    );
    expect(() => readSystemBundle(rebuilt((files) => (files["rules/nested/deep.md"] = strToU8("x"))))).toThrow(
      /not one of the files a system bundle may carry/
    );
  });

  it("refuses a system.json that is not a valid system, naming the field", () => {
    expect(() =>
      readSystemBundle(
        rebuilt((files) => {
          const system = JSON.parse(strFromU8(files["system.json"]));
          delete system.npcStatblock;
          files["system.json"] = strToU8(JSON.stringify(system));
        })
      )
    ).toThrow(/npcStatblock/);
  });

  it("refuses a manifest and a definition that disagree about the system", () => {
    expect(() =>
      readSystemBundle(
        rebuilt((files) => {
          const manifest = JSON.parse(strFromU8(files["manifest.json"]));
          manifest.systemId = "something-else";
          files["manifest.json"] = strToU8(JSON.stringify(manifest));
        })
      )
    ).toThrow(/names "something-else" but its system\.json is "monolith-2"/);
  });

  it("refuses catalogues belonging to another system", () => {
    expect(() =>
      readSystemBundle(
        rebuilt((files) => {
          const items = JSON.parse(strFromU8(files["items.json"]));
          items.system = "cairn";
          files["items.json"] = strToU8(JSON.stringify(items));
        })
      )
    ).toThrow(/items\.json belongs to "cairn"/);
  });

  it("refuses a bundle that names a rules file it does not carry", () => {
    expect(() => readSystemBundle(rebuilt((files) => delete files["rules/Monolith.md"]))).toThrow(
      /names rules\/Monolith\.md but does not contain it/
    );
  });

  it("refuses a bundle that names a table set it does not carry", () => {
    expect(() => readSystemBundle(rebuilt((files) => delete files["tables/monolith.json"]))).toThrow(
      /names tables\/monolith\.json but does not contain it/
    );
  });
});
