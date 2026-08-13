import { describe, expect, it } from "vitest";
import { normalizeCustomTables, parseCustomSet } from "./table-json.js";

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

describe("custom table JSON compatibility", () => {
  it("rejects overlapping or unordered normalized ranges", () => {
    expect(() =>
      normalizeCustomTables(
        [{ ...table, rows: [table.rows[0], { label: "5-12", min: 5, max: 12, cells: ["Overlap"] }] }],
        vocabulary
      )
    ).toThrow(/overlapping or unordered/);
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
