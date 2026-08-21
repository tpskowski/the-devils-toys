import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8 } from "fflate";
import { systemContentFor } from "./system-install.js";
import {
  SYSTEM_REPO_MARKER,
  buildSystemRepoMarker,
  readSystemRepoDirectory,
  readSystemRepoFiles,
  recordedSystemVersion,
  writeSystemRepoDirectory
} from "./system-repo.js";
import { installToybox, toyboxRepo } from "./test-fixture.js";
import { projectFile } from "./paths.js";

/** The fixture, read off disk exactly as an export would read it. */
const content = () => {
  installToybox();
  return systemContentFor("toybox");
};

const directories: string[] = [];
function scratch() {
  const directory = mkdtempSync(join(tmpdir(), "devils-system-repo-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** The repository as a map of files, which is the shape an archive arrives in. */
function filesFor(source = content()) {
  const files: Record<string, Uint8Array> = {
    [SYSTEM_REPO_MARKER]: strToU8(JSON.stringify(buildSystemRepoMarker(source.system))),
    "system.json": strToU8(JSON.stringify(source.system)),
    "items.json": strToU8(JSON.stringify(source.items)),
    "traits.json": strToU8(JSON.stringify(source.traits))
  };
  for (const [name, markdown] of Object.entries(source.rules)) files[`rules/${name}`] = strToU8(markdown);
  for (const [name, json] of Object.entries(source.tables)) files[`tables/${name}`] = strToU8(json);
  return files;
}

describe("a system repository", () => {
  it("writes the layout the application reads, and nothing else", () => {
    const directory = scratch();
    writeSystemRepoDirectory(directory, content());

    expect(readdirSync(directory).sort()).toEqual([
      "devilsystem.json",
      "items.json",
      "rules",
      "system.json",
      "tables",
      "traits.json"
    ]);
    expect(readdirSync(join(directory, "rules")).sort()).toEqual(["Toybox.md", "corrections.md"]);
    expect(readdirSync(join(directory, "tables"))).toEqual(["toybox.json"]);
  });

  it("carries a system out to disk and back unchanged", () => {
    const source = content();
    const directory = scratch();
    writeSystemRepoDirectory(directory, source);
    const read = readSystemRepoDirectory(directory);

    expect(read.system).toEqual(JSON.parse(JSON.stringify(source.system)));
    expect(read.items).toEqual(source.items);
    expect(read.traits).toEqual(source.traits);
    expect(read.rules).toEqual(source.rules);
    expect(read.tables).toEqual(source.tables);
  });

  it("records the licences its source documents state", () => {
    const directory = scratch();
    writeSystemRepoDirectory(directory, content());
    const marker = JSON.parse(readFileSync(join(directory, SYSTEM_REPO_MARKER), "utf8"));

    expect(marker).toMatchObject({ app: "devils-toys-system", formatVersion: 2, systemId: "toybox" });
    expect(marker.licenses).toEqual(["CC0 1.0"]);
  });

  /**
   * A version is the repository's release rather than anything `system.json`
   * says, so it is written through rather than derived. An export that dropped
   * it would turn every re-export into an unversioned system.
   */
  it("carries release metadata back out to the marker", () => {
    const directory = scratch();
    const release = {
      version: "1.2.0",
      breaking: true,
      releaseNotes: ["Choose a new background before play."]
    };
    writeSystemRepoDirectory(directory, content(), release);

    expect(JSON.parse(readFileSync(join(directory, SYSTEM_REPO_MARKER), "utf8"))).toMatchObject(release);
    expect(readSystemRepoDirectory(directory).marker).toMatchObject(release);
  });

  /** Decision 2: an unversioned system stays unversioned rather than gaining "". */
  it("writes no version at all for a system that declares none", () => {
    const directory = scratch();
    writeSystemRepoDirectory(directory, content());

    const marker = JSON.parse(readFileSync(join(directory, SYSTEM_REPO_MARKER), "utf8"));
    expect("version" in marker).toBe(false);
    expect(readSystemRepoDirectory(directory).marker.version).toBeUndefined();
    expect(readSystemRepoDirectory(directory).marker).toMatchObject({ breaking: false, releaseNotes: [] });
    expect(buildSystemRepoMarker(content().system)).not.toHaveProperty("version");
  });

  /**
   * The fixtures go on telling "declared" from "left out" apart, which is what
   * the pair is for. Toybox names a version; Plainbox deliberately does not.
   */
  it("reads the version each fixture declares, and the one that declares none", () => {
    installToybox();
    expect(readSystemRepoDirectory(toyboxRepo()).marker.version).toBe("1.0.0");
    expect(readSystemRepoDirectory(projectFile("fixtures", "plainbox")).marker.version).toBeUndefined();
  });

  it("leaves the author's own files alone, which is the whole difference from a bundle", () => {
    const directory = scratch();
    writeFileSync(join(directory, "README.md"), "# Toybox\n");
    writeFileSync(join(directory, "notes.md"), "Working notes.\n");
    mkdirSync(join(directory, ".github", "workflows"), { recursive: true });
    writeFileSync(join(directory, ".github", "workflows", "validate.yml"), "on: push\n");

    writeSystemRepoDirectory(directory, content());

    expect(readFileSync(join(directory, "README.md"), "utf8")).toBe("# Toybox\n");
    expect(readFileSync(join(directory, "notes.md"), "utf8")).toBe("Working notes.\n");
    expect(() => readSystemRepoDirectory(directory)).not.toThrow();
  });

  it("reports a rules file the system no longer names rather than deleting it", () => {
    const directory = scratch();
    writeSystemRepoDirectory(directory, content());
    writeFileSync(join(directory, "rules", "Toybox-draft.md"), "Superseded.\n");

    const { stale } = writeSystemRepoDirectory(directory, content());
    expect(stale).toEqual(["rules/Toybox-draft.md"]);
    expect(readFileSync(join(directory, "rules", "Toybox-draft.md"), "utf8")).toBe("Superseded.\n");
  });
});

describe("the version an install records", () => {
  const marker = (version?: string) => ({
    ...buildSystemRepoMarker(content().system),
    ...(version ? { version } : {})
  });

  it("is the marker's, not the catalogue entry's", () => {
    expect(recordedSystemVersion(marker("1.2.0"), "1.1")).toBe("1.2.0");
  });

  /** A repository named by hand has no catalogue entry, and used to record "". */
  it("is the marker's even where nothing else offered one", () => {
    expect(recordedSystemVersion(marker("1.2.0"))).toBe("1.2.0");
  });

  it("falls back to the catalogue only for a marker that declares none", () => {
    expect(recordedSystemVersion(marker(), "1.1")).toBe("1.1");
    expect(recordedSystemVersion(marker(""), "1.1")).toBe("1.1");
  });

  it("is empty where neither says anything, which is unversioned rather than wrong", () => {
    expect(recordedSystemVersion(marker())).toBe("");
  });
});

describe("refusing a directory that is not a system", () => {
  it("refuses one with no marker", () => {
    const files = filesFor();
    delete files[SYSTEM_REPO_MARKER];
    expect(() => readSystemRepoFiles(files)).toThrow(/no devilsystem\.json/);
  });

  it("refuses a marker written by something else", () => {
    const files = filesFor();
    files[SYSTEM_REPO_MARKER] = strToU8(JSON.stringify({ app: "some-other-tool", formatVersion: 1 }));
    expect(() => readSystemRepoFiles(files)).toThrow(/does not declare itself/);
  });

  it("refuses a format this build is too old to read", () => {
    const source = content();
    const files = filesFor(source);
    files[SYSTEM_REPO_MARKER] = strToU8(JSON.stringify({ ...buildSystemRepoMarker(source.system), formatVersion: 99 }));
    expect(() => readSystemRepoFiles(files)).toThrow(/newer format \(99\)/);
  });

  it("reads v1 markers with absent release metadata as a non-breaking release", () => {
    const source = content();
    const files = filesFor(source);
    files[SYSTEM_REPO_MARKER] = strToU8(
      JSON.stringify({
        ...buildSystemRepoMarker(source.system),
        formatVersion: 1,
        breaking: undefined,
        releaseNotes: undefined
      })
    );

    expect(readSystemRepoFiles(files).marker).toMatchObject({ formatVersion: 1, breaking: false, releaseNotes: [] });
  });

  it("refuses release metadata smuggled into a v1 marker", () => {
    const source = content();
    const files = filesFor(source);
    files[SYSTEM_REPO_MARKER] = strToU8(
      JSON.stringify({
        ...buildSystemRepoMarker(source.system),
        formatVersion: 1,
        breaking: true,
        releaseNotes: ["This must not be ignored."]
      })
    );

    expect(() => readSystemRepoFiles(files)).toThrow(/not a valid system marker/);
  });

  it("refuses a breaking marker without a plain-text, bounded release note", () => {
    for (const releaseNotes of [[], ["   "], ["first\nsecond"], ["x".repeat(501)]]) {
      const source = content();
      const files = filesFor(source);
      files[SYSTEM_REPO_MARKER] = strToU8(
        JSON.stringify({ ...buildSystemRepoMarker(source.system), breaking: true, releaseNotes })
      );
      expect(() => readSystemRepoFiles(files)).toThrow(/not a valid system marker/);
    }
  });

  it("refuses a marker naming a different system than system.json does", () => {
    const source = content();
    const files = filesFor(source);
    files[SYSTEM_REPO_MARKER] = strToU8(
      JSON.stringify({ ...buildSystemRepoMarker(source.system), systemId: "somewhere-else" })
    );
    expect(() => readSystemRepoFiles(files)).toThrow(/names "somewhere-else" but its system\.json is "toybox"/);
  });

  it("refuses an entry that would write outside the directory", () => {
    const files = filesFor();
    files["rules/../../escape.md"] = strToU8("no");
    expect(() => readSystemRepoFiles(files)).toThrow(/would write outside it/);
  });

  it("refuses a catalogue belonging to another system", () => {
    const source = content();
    const files = filesFor(source);
    files["items.json"] = strToU8(JSON.stringify({ ...source.items, system: "cairn" }));
    expect(() => readSystemRepoFiles(files)).toThrow(/items\.json belongs to "cairn"/);
  });

  it("refuses one missing a rules file its own system.json names", () => {
    const files = filesFor();
    delete files["rules/Toybox.md"];
    expect(() => readSystemRepoFiles(files)).toThrow(/names rules\/Toybox\.md but does not contain it/);
  });
});
