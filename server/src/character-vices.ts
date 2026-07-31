import { parseRollTables, type CharacterVice, type SystemId } from "@devils-toys/shared";
import { systems } from "./systems.js";
import { tablesForSetJson } from "./table-json.js";

/** Read Monolith's vice choices from its authoritative multi-column roll table. */
export function characterVicesFor(source: string | SystemId): CharacterVice[] {
  const tables =
    source === "cairn" || source === "monolith" || source === "cwn"
      ? tablesForSetJson(systems[source].sourceDocuments[0]?.tablesFile ?? "")
      : parseRollTables(source);
  const table = tables.find((candidate) => candidate.columns[0]?.toLowerCase() === "vice");
  return (table?.rows ?? []).map((row) => ({
    name: row.cells[0] ?? "",
    triggers: row.cells[1] ?? "",
    satisfying: row.cells[2] ?? ""
  }));
}
