import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BUILTIN_TABLE_TAGS, defaultTagLabel, parseRollTables, spliceTable } from "@devils-toys/shared";

let db: DatabaseSync;
let knownTags: typeof import("./table-tags.js").knownTags;
let tagUsage: typeof import("./table-tags.js").tagUsage;
let tagVocabulary: typeof import("./table-tags.js").tagVocabulary;
let dataDir = "";
let previousDataDir: string | undefined;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "devils-table-tags-"));
  const seedDatabase = new DatabaseSync(path.join(dataDir, "devils-toys.sqlite"));
  seedDatabase.close();
  previousDataDir = process.env.DEVILS_TOYS_DATA_DIR;
  process.env.DEVILS_TOYS_DATA_DIR = dataDir;
  vi.resetModules();
  ({ db } = await import("./db.js"));
  ({ knownTags, tagUsage, tagVocabulary } = await import("./table-tags.js"));
  // After the reset, so the fixture lands in this file's data directory and in
  // the registry belonging to the module graph the assertions will read.
  (await import("./test-fixture.js")).installToybox();
});

afterAll(() => {
  db.close();
  if (previousDataDir === undefined) delete process.env.DEVILS_TOYS_DATA_DIR;
  else process.env.DEVILS_TOYS_DATA_DIR = previousDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const setMarkdown = `## Generators

### Rumours (d6)
<!-- tags: fantasy, gear -->

| d6 | Rumour |
| --- | --- |
| 1 | A caravan is overdue |

### Reactions (d6)
<!-- tags: scifi -->

| d6 | Reaction |
| --- | --- |
| 1 | Hostile |
`;

/**
 * `rewriteSlug` is not exported — it is the router's own business — so these
 * exercise the same operations the router performs on a real database.
 */
function rewriteTags(from: string, to: string | null) {
  const rows = db.prepare("SELECT id, name, tags_json, markdown FROM table_sets").all() as {
    id: number;
    name: string;
    tags_json: string;
    markdown: string;
  }[];
  for (const row of rows) {
    const tags = JSON.parse(row.tags_json) as string[];
    const nextTags = [...new Set(tags.flatMap((tag) => (tag === from ? (to ? [to] : []) : [tag])))];
    const tables = parseRollTables(row.markdown)
      .filter((table) => table.tags.includes(from))
      .map((table) => ({
        ...table,
        tags: [...new Set(table.tags.flatMap((tag) => (tag === from ? (to ? [to] : []) : [tag])))]
      }))
      .sort((left, right) => right.source!.tableStart - left.source!.tableStart);
    let markdown = row.markdown;
    for (const table of tables) markdown = spliceTable(markdown, table);
    db.prepare("UPDATE table_sets SET name = ?, tags_json = ?, markdown = ? WHERE id = ?").run(
      row.name,
      JSON.stringify(nextTags),
      markdown,
      row.id
    );
  }
}

function storedTables() {
  return parseRollTables(
    (db.prepare("SELECT markdown FROM table_sets WHERE id = 1").get() as { markdown: string }).markdown
  );
}

function storedSet() {
  return db.prepare("SELECT name, tags_json FROM table_sets WHERE id = 1").get() as { name: string; tags_json: string };
}

function seed() {
  db.exec("DELETE FROM table_sets");
  db.exec("DELETE FROM accounts");
  db.prepare("INSERT INTO accounts (id, username, password_hash, account_role) VALUES (1, 'Warden', 'x', 'gm')").run();
  db.prepare("INSERT INTO table_sets (id, name, markdown, tags_json, created_by) VALUES (1, 'Set', ?, ?, 1)").run(
    setMarkdown,
    JSON.stringify(["fantasy", "gear"])
  );
}

describe("the tag vocabulary", () => {
  it("ships the built-in tags, in the order they are declared", () => {
    const vocabulary = tagVocabulary();
    expect(vocabulary.map((tag) => tag.slug)).toEqual([...BUILTIN_TABLE_TAGS]);
    expect(vocabulary.every((tag) => tag.builtin)).toBe(true);
  });

  it("labels each built-in tag readably", () => {
    const labels = Object.fromEntries(tagVocabulary().map((tag) => [tag.slug, tag.label]));
    expect(labels).toMatchObject({
      scifi: "Sci-fi",
      cyberpunk: "Cyberpunk",
      "real-world": "Real World",
      "character-building": "Character Building",
      "world-building": "World Building",
      "random-encounter": "Random Encounter",
      names: "Names",
      loot: "Loot"
    });
  });

  it("counts inherited tags across a registered system's catalogue", () => {
    db.exec("DELETE FROM table_sets");
    // The fixture's catalogue declares "fantasy", so every one of its tables
    // inherits it; one table names "character-building" for itself.
    const fantasy = tagUsage("fantasy");
    const character = tagUsage("character-building");

    expect(fantasy.sets).toBeGreaterThanOrEqual(1);
    expect(fantasy.tables).toBeGreaterThan(1);
    expect(character.tables).toBe(1);
    // A tag nothing carries is counted as such rather than being absent.
    expect(tagUsage("scifi")).toEqual({ sets: 0, tables: 0 });
  });

  it("counts an inherited custom-set tag on each table in that set", () => {
    db.exec("DELETE FROM table_sets");
    const before = tagUsage("fantasy");
    seed();
    const after = tagUsage("fantasy");

    expect(after.sets - before.sets).toBe(1);
    expect(after.tables - before.tables).toBe(2);
  });

  it("drops slugs the instance does not know and keeps vocabulary order", () => {
    expect(knownTags(["gear", "horror", "fantasy"])).toEqual(["fantasy", "gear"]);
  });

  it("takes a tag the instance added", () => {
    db.prepare(
      "INSERT OR IGNORE INTO table_tags (slug, label, builtin, sort_order) VALUES ('horror', 'Horror', 0, 9)"
    ).run();
    expect(knownTags(["horror"])).toEqual(["horror"]);
    db.exec("DELETE FROM table_tags WHERE slug = 'horror'");
  });

  it("would resurrect a built-in whose slug was moved aside, which is why that is refused", async () => {
    // Seeding is keyed on the slug, so a renamed built-in comes back beside its
    // replacement on the next start. The router refuses the rename for this
    // reason; this records the behaviour that makes the refusal necessary.
    db.exec("UPDATE table_tags SET slug = 'gear-moved' WHERE slug = 'gear'");
    for (const [position, slug] of BUILTIN_TABLE_TAGS.entries()) {
      db.prepare("INSERT OR IGNORE INTO table_tags (slug, label, builtin, sort_order) VALUES (?, ?, 1, ?)").run(
        slug,
        defaultTagLabel(slug),
        position
      );
    }
    expect(tagVocabulary().map((tag) => tag.slug)).toContain("gear");
    expect(tagVocabulary().map((tag) => tag.slug)).toContain("gear-moved");
    db.exec("DELETE FROM table_tags WHERE slug = 'gear-moved'");
  });
});

describe("rewriting a tag across every set", () => {
  it("renames a slug in the tables that name it, and leaves the rest alone", () => {
    seed();
    rewriteTags("fantasy", "high-fantasy");

    expect(storedTables().map((table) => table.tags)).toEqual([["high-fantasy", "gear"], ["scifi"]]);
    expect(storedSet()).toEqual({ name: "Set", tags_json: JSON.stringify(["high-fantasy", "gear"]) });
  });

  it("removes a slug without disturbing the other tags on the same table", () => {
    seed();
    rewriteTags("fantasy", null);

    expect(storedTables().map((table) => table.tags)).toEqual([["gear"], ["scifi"]]);
    expect(storedSet()).toEqual({ name: "Set", tags_json: JSON.stringify(["gear"]) });
  });

  it("drops the comment entirely when a table loses its only tag", () => {
    seed();
    rewriteTags("scifi", null);

    expect(storedTables()[1].tags).toEqual([]);
    expect(storedTables()[1].name).toBe("Reactions (d6)");
    expect(storedSet()).toEqual({ name: "Set", tags_json: JSON.stringify(["fantasy", "gear"]) });
  });

  it("folds one tag into another without leaving a duplicate", () => {
    seed();
    rewriteTags("gear", "fantasy");

    expect(storedTables()[0].tags).toEqual(["fantasy"]);
    expect(storedSet()).toEqual({ name: "Set", tags_json: JSON.stringify(["fantasy"]) });
  });
});
