import fs from "node:fs";
import crypto from "node:crypto";
import { SYSTEMS, canonicalJson, canonicalTableData, parseSet, projectFile } from "./table-json-lib.ts";
import { unreachableRows } from "../shared/src/roll-tables.ts";

const sets: Record<string, unknown> = {};
for (const [id, system] of Object.entries(SYSTEMS)) {
  const source = system.sourceDocuments[0];
  if (!source?.tablesFile) throw new Error(`${id} has no sourceDocument.tablesFile.`);
  const parsed = parseSet(fs.readFileSync(projectFile("raw", source.markdownFile), "utf8"), {
    setName: system.tableCatalog.label,
    sourceDocument: source.markdownFile,
    exclude: system.tableCatalog.exclude,
    system
  });
  sets[`system:${id}`] = {
    tableCount: parsed.tables.length,
    tables: parsed.tables.map((table) => {
      const digest = crypto
        .createHash("sha256")
        .update(canonicalJson(canonicalTableData(table)))
        .digest("hex");
      const tableForUnreachable = { ...table, rows: table.rows };
      return {
        id: table.id,
        dice: table.dice,
        rowCount: table.rows.length,
        columnCount: table.columns.length,
        unreachableRows: unreachableRows(tableForUnreachable),
        digest
      };
    })
  };
}

const manifestPath = projectFile("raw", "tables", "manifest.json");
let generatedAt = new Date().toISOString();
if (fs.existsSync(manifestPath)) {
  try {
    const previous = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { generatedAt?: unknown };
    if (typeof previous.generatedAt === "string") generatedAt = previous.generatedAt;
  } catch {
    // A malformed manifest is replaced with a fresh baseline below.
  }
}
const output = {
  _comment: "Pre-migration baseline. Never rewrite existing entries.",
  generatedAt,
  sets
};
fs.mkdirSync(projectFile("raw", "tables"), { recursive: true });
fs.writeFileSync(manifestPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
