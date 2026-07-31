import { parseRollTables, type CharacterVice } from "@devils-toys/shared";

/** Read Monolith's vice choices from its authoritative multi-column roll table. */
export function characterVicesFor(markdown: string): CharacterVice[] {
  const table = parseRollTables(markdown).find((candidate) => candidate.columns[0]?.toLowerCase() === "vice");
  return (table?.rows ?? []).map((row) => ({
    name: row.cells[0] ?? "",
    triggers: row.cells[1] ?? "",
    satisfying: row.cells[2] ?? ""
  }));
}
