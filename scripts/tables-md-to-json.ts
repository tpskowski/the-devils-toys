import fs from "node:fs";
import path from "node:path";
import { parseSet } from "./table-json-lib.ts";
import type { GameSystem } from "../shared/src/index.ts";

function value(name: string, fallback?: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function has(name: string) {
  return process.argv.includes(name);
}

function writeOrCheck(
  markdown: string,
  output: string,
  setName: string,
  sourceDocument?: string,
  exclude: readonly string[] = [],
  system?: GameSystem
) {
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

/**
 * Rebuilds the tables of a system, reading what it needs out of that system's
 * own `system.json`.
 *
 * This is how every system's tables are built now that no system lives in this
 * repository — including the test fixture, which is a system repository like any
 * other. It replaced an `--all` that walked the three compiled systems.
 *
 * It matters that this reads the definition rather than taking the Markdown
 * alone, because the alternative — `--in` and `--out` on their own — cannot see
 * `gmOnlyHeadings`, so it writes tables with no `classification`. A table with no
 * classification is refused to players outright, which means a system rebuilt
 * that way silently loses every table its players had.
 */
function systemRepo(directory: string) {
  const root = path.resolve(directory);
  const system = JSON.parse(fs.readFileSync(path.join(root, "system.json"), "utf8"));
  for (const source of system.sourceDocuments) {
    if (!source.tablesFile) continue;
    writeOrCheck(
      fs.readFileSync(path.join(root, "rules", source.markdownFile), "utf8"),
      path.join(root, "tables", source.tablesFile),
      system.tableCatalog.label,
      source.markdownFile,
      system.tableCatalog.exclude,
      system
    );
  }
}

const repo = value("--repo");
if (repo) {
  systemRepo(repo);
} else {
  const input = value("--in");
  const output = value("--out");
  if (!input || !output) throw new Error("Use --repo <dir>, or --in and --out.");
  const setName = value("--set-name", path.basename(input, path.extname(input)))!;
  const exclude = (value("--exclude", "") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  writeOrCheck(fs.readFileSync(path.resolve(input), "utf8"), path.resolve(output), setName, undefined, exclude);
}
