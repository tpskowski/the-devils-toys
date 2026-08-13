/**
 * Self-contained Node script included in every repository export. It uses only
 * Node built-ins so the recipient can review and run it before npm install.
 */
export const REPOSITORY_TABLE_IMPORT_SCRIPT = String.raw`#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const bundleRoot = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const assumeYes = args.includes("--yes");
const start = path.resolve(args.find((arg) => arg !== "--yes") || process.cwd());

function slug(value) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "tables";
}

function readableList(values) {
  if (values.length < 2) return values[0] || "";
  if (values.length === 2) return values[0] + " and " + values[1];
  return values.slice(0, -1).join(", ") + ", and " + values[values.length - 1];
}

function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function findRepository(from) {
  let current = from;
  while (true) {
    if (await exists(path.join(current, "package.json")) && await exists(path.join(current, "raw", "tables"))) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new Error("Could not find a Devil's Toys repository above " + from + ".");
    current = parent;
  }
}

function safeBundleFile(relative) {
  if (typeof relative !== "string" || path.isAbsolute(relative)) throw new Error("The bundle contains an unsafe file path.");
  const resolved = path.resolve(bundleRoot, relative);
  if (resolved !== bundleRoot && !resolved.startsWith(bundleRoot + path.sep)) throw new Error("The bundle contains an unsafe file path.");
  return resolved;
}

function validateDocument(document, label) {
  if (!document || document.formatVersion !== 1 || !Array.isArray(document.tables)) throw new Error("Invalid table JSON for " + label + ".");
  const ids = new Set();
  for (const table of document.tables) {
    if (!table || typeof table.id !== "string" || !table.id || typeof table.name !== "string" || !Array.isArray(table.rows)) {
      throw new Error("Invalid table in " + label + ".");
    }
    if (ids.has(table.id)) throw new Error("Duplicate table id " + table.id + " in " + label + ".");
    ids.add(table.id);
  }
  for (const table of document.tables) {
    for (const row of table.rows) {
      if (row.nextTableId && !ids.has(row.nextTableId)) throw new Error("Table " + table.name + " links to missing table " + row.nextTableId + ".");
    }
  }
  const links = new Map(document.tables.map((table) => [table.id, [...new Set(table.rows.map((row) => row.nextTableId).filter(Boolean))]]));
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error("Linked tables form a loop at " + id + " in " + label + ".");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of links.get(id) || []) visit(next);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of ids) visit(id);
}

function tableChanges(before, after) {
  const oldById = new Map((before?.tables || []).map((table) => [table.id, table]));
  const newById = new Map(after.tables.map((table) => [table.id, table]));
  return {
    added: after.tables.filter((table) => !oldById.has(table.id)).map((table) => table.name),
    updated: after.tables.filter((table) => oldById.has(table.id) && canonical(oldById.get(table.id)) !== canonical(table)).map((table) => table.name),
    removed: (before?.tables || []).filter((table) => !newById.has(table.id)).map((table) => table.name)
  };
}

function changeLine(change) {
  const parts = [];
  if (change.tables.added.length) parts.push("add " + readableList(change.tables.added));
  if (change.tables.updated.length) parts.push("update " + readableList(change.tables.updated));
  if (change.tables.removed.length) parts.push("remove " + readableList(change.tables.removed));
  return change.name + ": " + (parts.join("; ") || "set metadata only") + ".";
}

async function main() {
  const repository = await findRepository(start);
  const manifest = JSON.parse(await fs.readFile(path.join(bundleRoot, "manifest.json"), "utf8"));
  if (manifest.app !== "devils-tables-repository" || manifest.formatVersion !== 1 || !Array.isArray(manifest.sets)) {
    throw new Error("This is not a supported Devil's Tables repository bundle.");
  }

  const tablesDirectory = path.join(repository, "raw", "tables");
  const registryFile = path.join(tablesDirectory, "repository-sets.json");
  let registry = { formatVersion: 1, sets: [] };
  if (await exists(registryFile)) registry = JSON.parse(await fs.readFile(registryFile, "utf8"));
  if (registry.formatVersion !== 1 || !Array.isArray(registry.sets)) throw new Error("The repository table-set registry is invalid.");

  const planned = [];
  const reservedFiles = new Set(registry.sets.map((entry) => entry.file));
  const incomingIds = new Set();
  const incomingNames = new Set();
  for (const incoming of manifest.sets) {
    if (!incoming || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(incoming.id)) || typeof incoming.name !== "string" || !incoming.name.trim()) {
      throw new Error("The bundle manifest contains an invalid table set.");
    }
    const normalizedId = String(incoming.id).toLocaleLowerCase();
    const normalizedName = incoming.name.trim().toLocaleLowerCase();
    if (incomingIds.has(normalizedId)) throw new Error("The bundle manifest contains duplicate table-set id " + incoming.id + ".");
    if (incomingNames.has(normalizedName)) throw new Error("The bundle manifest contains duplicate table-set name " + incoming.name + ".");
    incomingIds.add(normalizedId);
    incomingNames.add(normalizedName);
  }

  const claimedRegistryEntries = new Set();
  for (const incoming of manifest.sets) {
    const document = JSON.parse(await fs.readFile(safeBundleFile(incoming.file), "utf8"));
    validateDocument(document, incoming.name);
    const existing = registry.sets.find((entry) => entry.id === incoming.id) ||
      registry.sets.find((entry) => String(entry.name).toLocaleLowerCase() === incoming.name.toLocaleLowerCase());
    if (existing) {
      if (claimedRegistryEntries.has(existing)) throw new Error("More than one bundled table set resolves to the existing " + existing.name + " table set.");
      claimedRegistryEntries.add(existing);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(String(existing.file))) throw new Error("Unsafe repository table filename for " + existing.name + ".");
      const target = path.join(tablesDirectory, existing.file);
      if (!await exists(target)) throw new Error("The registry names a missing file: " + existing.file + ".");
      const before = JSON.parse(await fs.readFile(target, "utf8"));
      if (canonical(before) !== canonical(document) || existing.name !== incoming.name) {
        planned.push({ kind: "update", name: incoming.name, entry: existing, target, document, tables: tableChanges(before, document) });
      }
      continue;
    }

    const base = slug(incoming.id || incoming.name);
    let file = base + ".json";
    for (let suffix = 2; reservedFiles.has(file) || await exists(path.join(tablesDirectory, file)); suffix += 1) file = base + "-" + suffix + ".json";
    reservedFiles.add(file);
    planned.push({
      kind: "new",
      name: incoming.name,
      entry: { id: incoming.id, name: incoming.name, file },
      target: path.join(tablesDirectory, file),
      document,
      tables: tableChanges(undefined, document)
    });
  }

  const updates = planned.filter((change) => change.kind === "update");
  const additions = planned.filter((change) => change.kind === "new");
  if (!planned.length) {
    console.log("All bundled table sets already match the repository. Nothing to do.");
    return;
  }

  const summary = [];
  if (updates.length) summary.push("update the " + readableList(updates.map((change) => change.name)) + " table set" + (updates.length === 1 ? "" : "s"));
  if (additions.length) summary.push("add the new " + readableList(additions.map((change) => change.name)) + " table set" + (additions.length === 1 ? "" : "s"));
  console.log("This will " + summary.join(", as well as ") + ".");
  for (const change of planned) console.log("- " + changeLine(change));

  let confirmed = assumeYes;
  if (!confirmed) {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await prompt.question("Confirm Y/N? ");
    prompt.close();
    confirmed = /^y(?:es)?$/i.test(answer.trim());
  }
  if (!confirmed) {
    console.log("No files changed.");
    return;
  }

  for (const change of planned) {
    await fs.writeFile(change.target, JSON.stringify(change.document, null, 2) + "\n", "utf8");
    if (change.kind === "new") registry.sets.push(change.entry);
    else {
      change.entry.name = change.name;
    }
  }
  registry.sets.sort((left, right) => left.name.localeCompare(right.name));
  await fs.writeFile(registryFile, JSON.stringify(registry, null, 2) + "\n", "utf8");
  console.log("Imported " + planned.length + " table set" + (planned.length === 1 ? "" : "s") + ". Review the changes with git diff.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
`;
