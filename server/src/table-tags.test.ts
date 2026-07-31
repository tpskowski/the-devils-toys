import { describe, expect, it } from "vitest";
import { BUILTIN_TABLE_TAGS, defaultTagLabel, parseRollTables } from "@devils-toys/shared";
import { knownTags, tagUsage, tagVocabulary } from "./table-tags.js";
import { db } from "./db.js";
import { parseCustomSet } from "./table-json.js";

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
  const rows = db.prepare("SELECT id, tables_json FROM table_sets").all() as { id: number; tables_json: string }[];
  for (const row of rows) {
    const document = parseCustomSet(row.tables_json, "Set");
    const tables = document.tables.map((table) => ({
      ...table,
      tags: [...new Set(table.tags.flatMap((tag) => (tag === from ? (to ? [to] : []) : [tag])))]
    }));
    db.prepare("UPDATE table_sets SET tables_json = ? WHERE id = ?").run(
      JSON.stringify({ ...document, tables }),
      row.id
    );
  }
}

function storedTables() {
  return parseCustomSet(
    (db.prepare("SELECT tables_json FROM table_sets WHERE id = 1").get() as { tables_json: string }).tables_json,
    "Set"
  ).tables;
}

function seed() {
  db.exec("DELETE FROM table_sets");
  db.exec("DELETE FROM accounts");
  db.prepare("INSERT INTO accounts (id, username, password_hash, account_role) VALUES (1, 'Warden', 'x', 'gm')").run();
  const document = {
    formatVersion: 1,
    setName: "Set",
    preamble: "",
    postamble: "",
    tables: parseRollTables(setMarkdown).map(({ source: _source, ...table }) => table)
  };
  db.prepare("INSERT INTO table_sets (id, name, tables_json, tags_json, created_by) VALUES (1, 'Set', ?, ?, 1)").run(
    JSON.stringify(document),
    JSON.stringify(["fantasy"])
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

  it("counts inherited tags across the built-in system catalogues", () => {
    db.exec("DELETE FROM table_sets");
    const fantasy = tagUsage("fantasy");
    const scifi = tagUsage("scifi");
    const character = tagUsage("character-building");

    expect(fantasy.sets).toBeGreaterThanOrEqual(1);
    expect(fantasy.tables).toBeGreaterThan(0);
    expect(scifi.sets).toBeGreaterThanOrEqual(2);
    expect(scifi.tables).toBeGreaterThan(0);
    expect(character.tables).toBeGreaterThan(0);
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
  });

  it("removes a slug without disturbing the other tags on the same table", () => {
    seed();
    rewriteTags("fantasy", null);

    expect(storedTables().map((table) => table.tags)).toEqual([["gear"], ["scifi"]]);
  });

  it("drops the comment entirely when a table loses its only tag", () => {
    seed();
    rewriteTags("scifi", null);

    expect(storedTables()[1].tags).toEqual([]);
    expect(storedTables()[1].name).toBe("Reactions (d6)");
  });

  it("folds one tag into another without leaving a duplicate", () => {
    seed();
    rewriteTags("gear", "fantasy");

    expect(storedTables()[0].tags).toEqual(["fantasy"]);
  });
});
