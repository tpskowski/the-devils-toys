import crypto from "node:crypto";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { unreachableRows } from "@devils-toys/shared";
import { projectFile } from "./paths.js";
import { readSetJson } from "./table-json.js";
import { systems } from "./systems.js";

function canonicalJson(value: unknown) {
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.keys(item as Record<string, unknown>)
          .sort()
          .map((key) => [key, sort((item as Record<string, unknown>)[key])])
      );
    }
    return item;
  };
  return JSON.stringify(sort(value));
}

function canonicalTableData(table: object) {
  const { origin: _origin, classification: _classification, ...data } = table as Record<string, unknown>;
  return data;
}

describe("the frozen table manifest", () => {
  it("hashes equivalent object content independently of key insertion order", () => {
    expect(canonicalJson({ z: { b: 2, a: 1 }, a: [{ d: 4, c: 3 }] })).toBe(
      canonicalJson({ a: [{ c: 3, d: 4 }], z: { a: 1, b: 2 } })
    );
  });

  it("matches every generated table without changing the baseline", () => {
    const manifest = JSON.parse(fs.readFileSync(projectFile("raw", "tables", "manifest.json"), "utf8"));
    for (const system of Object.values(systems)) {
      const source = system.sourceDocuments[0]!;
      const stored = readSetJson(source.tablesFile!);
      const expected = manifest.sets[`system:${system.id}`];
      expect(expected.tableCount).toBe(stored.tables.length);
      expect(stored.tables.map((table) => table.id)).toEqual(expected.tables.map((table: { id: string }) => table.id));
      for (const table of stored.tables) {
        const entry = expected.tables.find((candidate: { id: string }) => candidate.id === table.id);
        expect(entry).toBeTruthy();
        expect(entry.digest).toBe(
          crypto
            .createHash("sha256")
            .update(canonicalJson(canonicalTableData(table)))
            .digest("hex")
        );
        expect(entry.unreachableRows).toBe(unreachableRows(table));
      }
    }
  });
});
