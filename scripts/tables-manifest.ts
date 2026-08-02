import fs from "node:fs";
import crypto from "node:crypto";
import { SYSTEMS, canonicalJson, canonicalTableData, parseSet, projectFile, systemMarkdown } from "./table-json-lib.ts";
import { unreachableRows } from "../shared/src/roll-tables.ts";

type ManifestTable = {
  id: string;
  dice: string;
  rowCount: number;
  columnCount: number;
  unreachableRows: number;
  digest: string;
};
type ManifestSet = { tableCount: number; tables: ManifestTable[] };
type Manifest = {
  _comment?: string;
  generatedAt?: string;
  sets?: Record<string, ManifestSet>;
};

const recomputed: Record<string, ManifestSet> = {};
for (const [id, system] of Object.entries(SYSTEMS)) {
  const source = system.sourceDocuments[0];
  if (!source?.tablesFile) throw new Error(`${id} has no sourceDocument.tablesFile.`);
  const parsed = parseSet(systemMarkdown(system), {
    setName: system.tableCatalog.label,
    sourceDocument: source.markdownFile,
    exclude: system.tableCatalog.exclude,
    system
  });
  recomputed[`system:${id}`] = {
    tableCount: parsed.tables.length,
    tables: parsed.tables.map((table) => {
      const digest = crypto
        .createHash("sha256")
        .update(canonicalJson(canonicalTableData(table)))
        .digest("hex");
      return {
        id: table.id,
        dice: table.dice,
        rowCount: table.rows.length,
        columnCount: table.columns.length,
        unreachableRows: unreachableRows(table),
        digest
      };
    })
  };
}

const manifestPath = projectFile("raw", "tables", "manifest.json");
let previous: Manifest | undefined;
if (fs.existsSync(manifestPath)) {
  previous = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
  for (const [setId, current] of Object.entries(recomputed)) {
    const stored = previous.sets?.[setId];
    if (!stored) continue;
    if (stored.tableCount !== current.tableCount || stored.tables.length !== current.tables.length)
      throw new Error(`Stored manifest set ${setId} changed its table count; refusing to rewrite the baseline.`);
    for (const storedTable of stored.tables) {
      const currentTable = current.tables.find((table) => table.id === storedTable.id);
      if (!currentTable || currentTable.digest !== storedTable.digest)
        throw new Error(`Stored manifest table ${setId}/${storedTable.id} changed; refusing to rewrite the baseline.`);
    }
  }
}
const sets = { ...(previous?.sets ?? {}) };
for (const [setId, set] of Object.entries(recomputed)) if (!(setId in sets)) sets[setId] = set;
const output = {
  _comment: previous?._comment ?? "Pre-migration baseline. Never rewrite existing entries.",
  generatedAt: previous?.generatedAt ?? new Date().toISOString(),
  sets
};
fs.mkdirSync(projectFile("raw", "tables"), { recursive: true });
fs.writeFileSync(manifestPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
