import { describe, expect, it } from "vitest";
import {
  normalizeCustomTables,
  parseCustomSet,
  parseSetJson,
  parseRepositorySetRegistry,
  validateRepositoryTableTags
} from "./table-json.js";

const vocabulary = [{ slug: "fantasy", label: "Fantasy", builtin: true, sortOrder: 0 }];
const table = {
  name: "Encounters",
  dice: "d20",
  columns: ["Result"],
  tags: ["fantasy"],
  rows: [
    { label: "1-10", min: 1, max: 10, cells: ["First"] },
    { label: "11-20", min: 11, max: 20, cells: ["Second"] }
  ]
};

describe("installed table validation", () => {
  const storedTable = () => ({ ...table, id: "encounters", category: "Travel", section: "Travel" });
  const read = (entry: unknown) =>
    parseSetJson(JSON.stringify({ formatVersion: 1, setName: "Travel", tables: [entry] }), "tables.json");

  it("accepts supported dice and rows beyond the stated die without rewriting them", () => {
    expect(read(storedTable()).tables[0]).toEqual(storedTable());
    expect(read({ ...storedTable(), dice: "2d6" }).tables[0].dice).toBe("2d6");
  });

  it.each(["tags", "columns", "dice", "section", "category", "rows"])("rejects a missing %s", (key) => {
    const entry: Record<string, unknown> = storedTable();
    delete entry[key];
    expect(() => read(entry)).toThrow(/Invalid table JSON/);
  });

  it.each([
    { tags: "fantasy" },
    { tags: [null] },
    { columns: [] },
    { dice: "d9" },
    { rows: [null] },
    { rows: [{ label: "1", min: 1, max: 1, cells: [12] }] },
    { rows: [{ label: "1", min: 2, max: 1, cells: ["Invalid"] }] },
    { rows: [{ label: "1", min: 1, max: 1, cells: [] }] },
    { classification: "everyone" }
  ])("rejects malformed runtime fields: %j", (overrides) => {
    expect(() => read({ ...storedTable(), ...overrides })).toThrow(/Invalid table JSON/);
  });
});

describe("custom table JSON compatibility", () => {
  it("rejects overlapping or unordered normalized ranges", () => {
    expect(() =>
      normalizeCustomTables(
        [{ ...table, rows: [table.rows[0], { label: "5-12", min: 5, max: 12, cells: ["Overlap"] }] }],
        vocabulary
      )
    ).toThrow(/overlapping or unordered/);
  });

  it("takes a d5 table, and still refuses a die this application has not got", () => {
    const [normalized] = normalizeCustomTables(
      [{ ...table, dice: "d5", rows: [{ label: "1-5", min: 1, max: 5, cells: ["Something"] }] }],
      vocabulary
    );
    expect(normalized.dice).toBe("d5");
    expect(() => normalizeCustomTables([{ ...table, dice: "d9" }], vocabulary)).toThrow(
      /invalid name, die, or columns/
    );
  });

  it("requires the effective vocabulary when parsing legacy bundles", () => {
    const value = JSON.stringify({ formatVersion: 1, tables: [{ ...table, tags: ["undeclared"] }] });
    expect(() => parseCustomSet(value, "Imported", vocabulary)).toThrow(/Unknown table tag/);
  });

  it("keeps linked-table targets in JSON rows", () => {
    const [normalized] = normalizeCustomTables(
      [
        {
          ...table,
          rows: [{ ...table.rows[0], nextTableId: "follow-up" }]
        }
      ],
      vocabulary
    );
    expect(normalized.rows[0].nextTableId).toBe("follow-up");
  });
});

describe("repository table JSON", () => {
  it("rejects duplicate public set ids in the registry", () => {
    expect(() =>
      parseRepositorySetRegistry(
        JSON.stringify({
          formatVersion: 1,
          sets: [
            { id: "omens", name: "Omens", file: "omens.json" },
            { id: "omens", name: "Other omens", file: "other-omens.json" }
          ]
        })
      )
    ).toThrow("Invalid repository table-set entry.");
  });

  it("rejects repository tags outside the active vocabulary", () => {
    expect(() => validateRepositoryTableTags([{ tags: ["unknown"] }], [], "omens.json")).toThrow(
      /Unknown repository table tag/
    );
  });
});
