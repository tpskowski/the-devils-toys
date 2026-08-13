import { parseRollTables, type CharacterVice, type SystemId } from "@devils-toys/shared";
import { hasSystem, systemOrThrow } from "./systems.js";
import { tablesForSetJson } from "./table-json.js";

/**
 * Read a system's vice choices from its authoritative multi-column roll table.
 * `source` is either a registered system or Markdown to parse directly, which
 * is what the tests hand it — asking the registry is how the two are told
 * apart, rather than naming the systems that have vices.
 */
export function characterVicesFor(source: string | SystemId, column = "Vice"): CharacterVice[] {
  const registered = hasSystem(source);
  const tables = registered
    ? tablesForSetJson(source, systemOrThrow(source).sourceDocuments[0]?.tablesFile ?? "")
    : parseRollTables(source);
  const wanted = (registered ? (systemOrThrow(source).viceCatalog?.column ?? column) : column).toLowerCase();
  const table = tables.find((candidate) => candidate.columns[0]?.toLowerCase() === wanted);
  return (table?.rows ?? []).map((row) => ({
    name: row.cells[0] ?? "",
    triggers: row.cells[1] ?? "",
    satisfying: row.cells[2] ?? ""
  }));
}
