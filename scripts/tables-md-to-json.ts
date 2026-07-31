import fs from "node:fs";
import path from "node:path";
import { SYSTEMS, parseSet, projectFile } from "./table-json-lib.ts";

function value(name: string, fallback?: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function has(name: string) {
  return process.argv.includes(name);
}

function writeOrCheck(
  input: string,
  output: string,
  setName: string,
  sourceDocument?: string,
  exclude: readonly string[] = [],
  system?: (typeof SYSTEMS)[keyof typeof SYSTEMS]
) {
  const markdown = fs.readFileSync(input, "utf8");
  const document = parseSet(markdown, { setName, sourceDocument, exclude, system });
  const rendered = `${JSON.stringify(document, null, 2)}\n`;
  if (has("--check")) {
    const existing = fs.readFileSync(output, "utf8");
    if (existing !== rendered) {
      throw new Error(`${path.relative(process.cwd(), output)} is out of date; regenerate it with this command.`);
    }
    return;
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, rendered, "utf8");
}

function allSystems() {
  for (const [id, system] of Object.entries(SYSTEMS)) {
    const source = system.sourceDocuments[0];
    if (!source?.tablesFile) throw new Error(`${id} has no sourceDocument.tablesFile.`);
    writeOrCheck(
      projectFile("raw", source.markdownFile),
      projectFile("raw", "tables", source.tablesFile),
      system.tableCatalog.label,
      source.markdownFile,
      system.tableCatalog.exclude,
      system
    );
  }
}

if (has("--all")) {
  allSystems();
} else {
  const input = value("--in");
  const output = value("--out");
  if (!input || !output) throw new Error("Use --in and --out, or --all.");
  const setName = value("--set-name", path.basename(input, path.extname(input)))!;
  const exclude = (value("--exclude", "") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  writeOrCheck(path.resolve(input), path.resolve(output), setName, undefined, exclude);
}
