import { describe, expect, it } from "vitest";
import { parseRollTables } from "@devils-toys/shared";
import { rollTableSequence } from "./tables.js";

const tables = parseRollTables(`## Body part

| d4 | Result |
| --- | --- |
| 1 | Head <!-- next-table: head --> |
| 2-4 | Torso <!-- next-table: torso --> |

## Head

| d8 | Result |
| --- | --- |
| 1-8 | Short neck |

## Torso

| d8 | Result |
| --- | --- |
| 1-8 | Three nipples |
`);

describe("rolling linked tables", () => {
  it("rolls the table selected by the first result and keeps both results", () => {
    const random = [0, 0.5];
    const sequence = rollTableSequence(
      { id: "custom:1", name: "Mutations" },
      tables,
      tables[0],
      "private",
      0,
      () => random.shift() ?? 0
    );
    expect(sequence.map((roll) => [roll.tableId, roll.total, roll.text])).toEqual([
      ["body-part", 1, "Head"],
      ["head", 5, "Short neck"]
    ]);
  });

  it("stops after the first table when its row has no follow-up", () => {
    const unlinked = { ...tables[0], rows: tables[0].rows.map((row) => ({ ...row, nextTableId: undefined })) };
    expect(
      rollTableSequence({ id: "custom:1", name: "Mutations" }, tables, unlinked, "private", 0, () => 0)
    ).toHaveLength(1);
  });
});
