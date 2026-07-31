import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8, strToU8, zipSync } from "fflate";
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
  const archive = unzipSync(buildRepoBundle("Market Rumours", tables, ["fantasy"]));

  it("holds the Markdown under raw/ and the instructions beside it", () => {
    expect(Object.keys(archive).sort()).toEqual(["MERGE.md", "raw/Market Rumours.md"]);
  });

  it("writes Markdown the parser reads back as the same tables", () => {
    const parsed = parseRollTables(strFromU8(archive["raw/Market Rumours.md"]));
    expect(parsed.map((table) => [table.name, table.dice, table.tags])).toEqual([["Rumours", "d6", ["fantasy"]]]);
  });

  it("names the real files and the tags in its instructions", () => {
    const merge = strFromU8(archive["MERGE.md"]);
    expect(merge).toContain("sourceDocuments");
    expect(merge).toContain("contentModules");
    expect(merge).toContain("imports");
    expect(merge).toContain("server/src/systems.ts");
    expect(merge).toContain('tags: ["fantasy"]');
    expect(merge).toContain("systems/market-rumours/");
  });
});
