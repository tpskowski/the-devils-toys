import { describe, expect, it } from "vitest";
import { strToU8, zipSync, unzipSync, strFromU8 } from "fflate";
import { buildSystemBundle, readSystemBundle, renameSystem, type SystemBundleContent } from "./system-bundles.js";
import { systemContentFor } from "./system-install.js";
import { installToybox } from "./test-fixture.js";

installToybox();

/** The fixture, read off disk exactly as an export would read it. */
const fixtureContent = () => systemContentFor("toybox");

const bundleOf = (content: SystemBundleContent) => readSystemBundle(buildSystemBundle(content));

describe("a system bundle", () => {
  it("carries a compiled system out and back unchanged", () => {
    const content = fixtureContent();
    const read = bundleOf(content);
    expect(read.system).toEqual(JSON.parse(JSON.stringify(content.system)));
    expect(read.items).toEqual(content.items);
    expect(read.traits).toEqual(content.traits);
    expect(read.rules).toEqual(content.rules);
    expect(read.tables).toEqual(content.tables);
  });

  it("records the licences its source documents state", () => {
    const archive = unzipSync(buildSystemBundle(fixtureContent()));
    const manifest = JSON.parse(strFromU8(archive["manifest.json"]));
    expect(manifest.app).toBe("devils-toys-system");
    expect(manifest.systemId).toBe("toybox");
    expect(manifest.licenses).toEqual(["CC0 1.0"]);
  });

  it("carries declared release metadata in its manifest", () => {
    const release = {
      version: "1.2.0",
      breaking: true,
      releaseNotes: ["Characters need a fresh background choice."]
    };
    const archive = unzipSync(buildSystemBundle(fixtureContent(), release));
    const manifest = JSON.parse(strFromU8(archive["manifest.json"]));
    expect(manifest).toMatchObject({ bundleVersion: 2, ...release });
    expect(readSystemBundle(buildSystemBundle(fixtureContent(), release)).manifest).toMatchObject(release);
  });

  it("normalizes a legacy v1 bundle's absent release metadata", () => {
    const files = unzipSync(buildSystemBundle(fixtureContent()));
    const manifest = JSON.parse(strFromU8(files["manifest.json"]));
    manifest.bundleVersion = 1;
    files["manifest.json"] = strToU8(JSON.stringify(manifest));

    expect(readSystemBundle(zipSync(files)).manifest).toMatchObject({
      bundleVersion: 1,
      breaking: false,
      releaseNotes: []
    });
  });

  it("puts the rules and tables where the layout says", () => {
    const names = Object.keys(unzipSync(buildSystemBundle(fixtureContent()))).sort();
    expect(names).toEqual([
      "items.json",
      "manifest.json",
      "rules/Toybox.md",
      "rules/corrections.md",
      "system.json",
      "tables/toybox.json",
      "traits.json"
    ]);
  });
});

describe("renaming a system for a bundle", () => {
  const renamed = () => renameSystem(fixtureContent(), "toybox-2", "Toybox (installed)");

  it("moves all five things namespaced by the id, and nothing else", () => {
    const before = fixtureContent();
    const after = renamed();
    expect(after.system.id).toBe("toybox-2");
    expect(after.system.name).toBe("Toybox (installed)");
    expect(after.system.contentModules.map((module) => module.id)).toEqual(["toybox-2/core", "toybox-2/gm"]);
    expect(after.system.contentModules.map((module) => module.storageNamespace)).toEqual([
      "toybox-2.core",
      "toybox-2.gm"
    ]);
    // The dependency between the two modules has to move with their ids, or the
    // GM module requires something that no longer exists.
    expect(after.system.contentModules[1].requires).toEqual(["toybox-2/core"]);
    expect(after.system.contentModules[1].provides).toEqual(["toybox-2/gm"]);
    expect(after.items.system).toBe("toybox-2");
    expect(after.traits.system).toBe("toybox-2");
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
    expect(ids.length).toBeGreaterThan(5);
    expect(ids.every((id) => id.startsWith("toybox-2/"))).toBe(true);
    expect(ids.some((id) => id.startsWith("toybox/"))).toBe(false);
    for (const id of after.items.retired ?? []) expect(id.startsWith("toybox-2/")).toBe(true);
  });

  it("leaves a capability namespace that is not the system's own alone", () => {
    // A module may provide a capability named for a *family* rather than for the
    // system itself — Cities Without Number's provide "without-number/core@1".
    // Renaming the system must not touch those.
    const source = fixtureContent();
    const family = {
      ...source,
      system: {
        ...source.system,
        contentModules: source.system.contentModules.map((module) => ({
          ...module,
          provides: [...module.provides, "without-number/cyberware@1"],
          requires: ["without-number/core@1"]
        }))
      }
    };
    const after = renameSystem(family, "toybox-2");
    expect(after.system.contentModules.map((module) => module.id)).toContain("toybox-2/core");
    expect(after.system.contentModules.find((module) => module.id === "toybox-2/core")?.provides).toEqual([
      "toybox-2/core",
      "without-number/cyberware@1"
    ]);
    expect(after.system.contentModules.find((module) => module.id === "toybox-2/core")?.requires).toEqual([
      "without-number/core@1"
    ]);
  });

  it("produces a bundle that reads back as the renamed system", () => {
    const read = bundleOf(renamed());
    expect(read.system.id).toBe("toybox-2");
    expect(read.manifest.systemId).toBe("toybox-2");
    expect(read.items.system).toBe("toybox-2");
  });

  it("refuses an id it could not write to disk", () => {
    for (const id of ["Toybox2", "../escape", "toybox 2", ""])
      expect(() => renameSystem(fixtureContent(), id)).toThrow(/not a usable system id/);
  });
});

describe("reading a bundle that is not one", () => {
  const bytes = () => buildSystemBundle(renameSystem(fixtureContent(), "toybox-2"));

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

  it("refuses v2 release metadata that cannot describe a release", () => {
    expect(() =>
      readSystemBundle(
        rebuilt((files) => {
          const manifest = JSON.parse(strFromU8(files["manifest.json"]));
          manifest.breaking = true;
          files["manifest.json"] = strToU8(JSON.stringify(manifest));
        })
      )
    ).toThrow(/manifest\.json is not a valid system bundle manifest/);
  });

  it("refuses blank, control-character, overlong, and excessive v2 release notes", () => {
    for (const releaseNotes of [
      ["   "],
      ["first\nsecond"],
      ["x".repeat(501)],
      Array.from({ length: 13 }, (_, index) => `note ${index + 1}`)
    ])
      expect(() =>
        readSystemBundle(
          rebuilt((files) => {
            const manifest = JSON.parse(strFromU8(files["manifest.json"]));
            manifest.releaseNotes = releaseNotes;
            files["manifest.json"] = strToU8(JSON.stringify(manifest));
          })
        )
      ).toThrow(/manifest\.json is not a valid system bundle manifest/);
  });

  it("refuses v2 release metadata smuggled into a v1 payload", () => {
    expect(() =>
      readSystemBundle(
        rebuilt((files) => {
          const manifest = JSON.parse(strFromU8(files["manifest.json"]));
          manifest.bundleVersion = 1;
          manifest.breaking = true;
          manifest.releaseNotes = ["This must not be ignored."];
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
    ).toThrow(/names "something-else" but its system\.json is "toybox-2"/);
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
    expect(() => readSystemBundle(rebuilt((files) => delete files["rules/Toybox.md"]))).toThrow(
      /names rules\/Toybox\.md but does not contain it/
    );
  });

  it("refuses a bundle that names a table set it does not carry", () => {
    expect(() => readSystemBundle(rebuilt((files) => delete files["tables/toybox.json"]))).toThrow(
      /names tables\/toybox\.json but does not contain it/
    );
  });
});
