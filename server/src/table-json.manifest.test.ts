import crypto from "node:crypto";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { unreachableRows } from "@devils-toys/shared";
import { projectFile } from "./paths.js";
import { readSetJson } from "./table-json.js";
import { systems } from "./systems.js";

function canonical(table: object) {
  const value = table as Record<string, unknown>;
  const { origin: _origin, classification: _classification, ...data } = value;
  return data;
}

describe("the frozen table manifest", () => {
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
            .update(JSON.stringify(canonical(table)))
            .digest("hex")
        );
        expect(entry.unreachableRows).toBe(unreachableRows(table));
      }
    }
  });
});
