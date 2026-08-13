import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8, strToU8, zipSync } from "fflate";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseRollTables } from "@devils-toys/shared";
import { buildBundle, buildRepoBundle, compareToExisting, readBundle } from "./table-bundles.js";

const markdown = `### Rumours

<!-- tags: fantasy -->
| d6 | Rumour |
| --- | --- |
| 1-6 | The well has gone bitter |
`;

const sets = [{ name: "Market rumours", markdown, tags: ["random-encounter"] }];
const tags = [{ slug: "random-encounter", label: "Random Encounter", builtin: true, sortOrder: 3 }];

describe("a portable bundle", () => {
  it("holds a manifest and one Markdown file per set", () => {
    const files = unzipSync(buildBundle(sets, tags));
    expect(Object.keys(files).sort()).toEqual(["manifest.json", "sets/market-rumours.md"]);
    const manifest = JSON.parse(strFromU8(files["manifest.json"]));
    expect(manifest).toMatchObject({ app: "devils-tables", bundleVersion: 1 });
    expect(manifest.sets).toEqual([
      { file: "sets/market-rumours.md", name: "Market rumours", tags: ["random-encounter"] }
    ]);
    expect(manifest.tags).toEqual(tags);
  });

  it("reads back exactly what went in", () => {
    const read = readBundle(buildBundle(sets, tags), []);
    expect(read.sets).toEqual(sets);
    expect(read.tags).toEqual(tags);
    expect(parseRollTables(read.sets[0].markdown)[0].tags).toEqual(["fantasy"]);
  });

  it("gives two sets of the same name their own files", () => {
    const files = unzipSync(buildBundle([sets[0], { ...sets[0] }], tags));
    expect(Object.keys(files).sort()).toEqual(["manifest.json", "sets/market-rumours-2.md", "sets/market-rumours.md"]);
  });

  it("refuses something that is not a zip", () => {
    expect(() => readBundle(strToU8("not a zip"), [])).toThrow(/not a readable zip/);
  });

  it("refuses a zip that is not a bundle", () => {
    expect(() => readBundle(zipSync({ "readme.txt": strToU8("hello") }), [])).toThrow(/no manifest\.json/);
  });

  it("refuses a bundle from another application", () => {
    const archive = zipSync({ "manifest.json": strToU8('{"app":"something-else","sets":[]}') });
    expect(() => readBundle(archive, [])).toThrow(/not written by The Devil's Tables/);
  });

  it("refuses a bundle from a newer version rather than guessing", () => {
    const archive = zipSync({
      "manifest.json": strToU8('{"app":"devils-tables","bundleVersion":99,"sets":[]}')
    });
    expect(() => readBundle(archive, [])).toThrow(/newer version \(99\)/);
  });

  it("refuses a manifest naming a file the archive does not hold", () => {
    const archive = zipSync({
      "manifest.json": strToU8(
        '{"app":"devils-tables","bundleVersion":1,"sets":[{"file":"sets/gone.md","name":"Gone","tags":[]}]}'
      )
    });
    expect(() => readBundle(archive, [])).toThrow(/does not contain it/);
  });

  it("refuses undeclared tags in a legacy JSON bundle", () => {
    const table = parseRollTables(markdown)[0];
    const { source: _source, ...stored } = { ...table, tags: ["undeclared"] };
    const archive = zipSync({
      "manifest.json": strToU8(
        JSON.stringify({
          app: "devils-tables",
          bundleVersion: 2,
          sets: [{ file: "sets/legacy.json", name: "Legacy", tags: [] }],
          tags: []
        })
      ),
      "sets/legacy.json": strToU8(JSON.stringify({ formatVersion: 1, tables: [stored] }))
    });

    expect(() => readBundle(archive, [])).toThrow(/table JSON.*could not be read/);
  });
});

describe("comparing a bundle with what is already here", () => {
  it("tells new, identical, and conflicting sets apart", () => {
    const existing = [
      { name: "Market rumours", markdown },
      { name: "Old omens", markdown: "### Omens\n\n| d6 | x |\n| --- | --- |\n| 1 | y |\n" }
    ];
    const incoming = [
      { name: "Market rumours", markdown, tags: [] },
      { name: "Old omens", markdown: "### Omens\n\n| d6 | x |\n| --- | --- |\n| 2 | z |\n", tags: [] },
      { name: "Brand new", markdown, tags: [] }
    ];
    expect(compareToExisting(incoming, existing).map((entry) => [entry.name, entry.status])).toEqual([
      ["Market rumours", "identical"],
      ["Old omens", "conflict"],
      ["Brand new", "new"]
    ]);
  });

  it("matches names regardless of case", () => {
    expect(
      compareToExisting([{ name: "MARKET RUMOURS", markdown, tags: [] }], [{ name: "Market rumours", markdown }])[0]
        .status
    ).toBe("identical");
  });
});

describe("a repository bundle", () => {
  const tables = parseRollTables(markdown);
  const archiveBytes = buildRepoBundle([{ name: "Market Rumours", tables }]);
  const archive = unzipSync(archiveBytes);

  it("holds JSON sets, a manifest, and the confirmation-based importer", () => {
    expect(Object.keys(archive).sort()).toEqual([
      "README.md",
      "import-tables.mjs",
      "manifest.json",
      "sets/market-rumours.json"
    ]);
    expect(strFromU8(archive["import-tables.mjs"])).toContain("Confirm Y/N?");
  });

  it("writes runtime JSON without Markdown source locations", () => {
    const set = JSON.parse(strFromU8(archive["sets/market-rumours.json"]));
    expect(set).toMatchObject({ formatVersion: 1, setName: "Market Rumours" });
    expect(set.tables.map((table: { name: string; dice: string; tags: string[] }) => [table.name, table.dice, table.tags]))
      .toEqual([["Rumours", "d6", ["fantasy"]]]);
    expect(set.tables[0]).not.toHaveProperty("source");
  });

  it("previews updates and new sets, then leaves the repository untouched on N", () => {
    const root = mkdtempSync(join(tmpdir(), "devils-repo-import-"));
    try {
      const repo = join(root, "repo");
      const bundle = join(root, "bundle");
      mkdirSync(join(repo, "raw", "tables"), { recursive: true });
      mkdirSync(join(bundle, "sets"), { recursive: true });
      writeFileSync(join(repo, "package.json"), '{"name":"the-devils-toys"}\n');
      writeFileSync(
        join(repo, "raw", "tables", "repository-sets.json"),
        JSON.stringify({ formatVersion: 1, sets: [{ id: "market-rumours", name: "Market Rumours", file: "market-rumours.json" }] }, null, 2) + "\n"
      );
      const incoming = JSON.parse(strFromU8(archive["sets/market-rumours.json"]));
      const before = structuredClone(incoming);
      before.tables[0].rows[0].cells[0] = "Old rumour";
      writeFileSync(join(repo, "raw", "tables", "market-rumours.json"), JSON.stringify(before, null, 2) + "\n");
      for (const [name, contents] of Object.entries(archive)) {
        const target = join(bundle, name);
        mkdirSync(join(target, ".."), { recursive: true });
        writeFileSync(target, contents);
      }

      const run = spawnSync(process.execPath, [join(bundle, "import-tables.mjs"), repo], {
        input: "n\n",
        encoding: "utf8"
      });
      expect(run.status).toBe(0);
      expect(run.stdout).toContain("This will update the Market Rumours table set.");
      expect(run.stdout).toContain("Confirm Y/N?");
      expect(run.stdout).toContain("No files changed.");
      expect(JSON.parse(readFileSync(join(repo, "raw", "tables", "market-rumours.json"), "utf8"))).toEqual(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("imports confirmed updates and new sets into the repository registry", () => {
    const second = parseRollTables(markdown.replace("Rumours", "Portents"));
    const files = unzipSync(buildRepoBundle([
      { name: "Market Rumours", tables },
      { name: "New Portents", tables: second }
    ]));
    const root = mkdtempSync(join(tmpdir(), "devils-repo-import-"));
    try {
      const repo = join(root, "repo");
      const bundle = join(root, "bundle");
      mkdirSync(join(repo, "raw", "tables"), { recursive: true });
      mkdirSync(join(bundle, "sets"), { recursive: true });
      writeFileSync(join(repo, "package.json"), '{"name":"the-devils-toys"}\n');
      writeFileSync(
        join(repo, "raw", "tables", "repository-sets.json"),
        JSON.stringify({ formatVersion: 1, sets: [{ id: "market-rumours", name: "Market Rumours", file: "market-rumours.json" }] }, null, 2) + "\n"
      );
      writeFileSync(join(repo, "raw", "tables", "market-rumours.json"), '{"formatVersion":1,"setName":"Market Rumours","tables":[]}\n');
      for (const [name, contents] of Object.entries(files)) {
        const target = join(bundle, name);
        mkdirSync(join(target, ".."), { recursive: true });
        writeFileSync(target, contents);
      }

      const run = spawnSync(process.execPath, [join(bundle, "import-tables.mjs"), repo], {
        input: "y\n",
        encoding: "utf8"
      });
      expect(run.status).toBe(0);
      expect(run.stdout).toContain("update the Market Rumours table set, as well as add the new New Portents table set");
      const registry = JSON.parse(readFileSync(join(repo, "raw", "tables", "repository-sets.json"), "utf8"));
      expect(registry.sets.map((entry: { name: string }) => entry.name)).toEqual(["Market Rumours", "New Portents"]);
      expect(JSON.parse(readFileSync(join(repo, "raw", "tables", "new-portents.json"), "utf8")).tables).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
