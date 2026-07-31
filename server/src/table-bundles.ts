import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import {
  parseRollTables,
  serializeSet,
  type RollTable,
  type TableTag,
  type TableTagDefinition
} from "@devils-toys/shared";
import { parseCustomSet, type CustomSetDocument } from "./table-json.js";

/**
 * The two archives The Devil's Tables produces.
 *
 * A **bundle** carries sets between copies of the application: the Markdown as
 * it was written, plus a manifest naming each set and the tag vocabulary it
 * relies on. A **repo bundle** is the other direction — one set shaped the way
 * `raw/` expects, with written instructions for folding it into the repository.
 */

export const BUNDLE_VERSION = 2;

export interface BundleManifest {
  bundleVersion: number;
  exportedAt: string;
  app: "devils-tables";
  sets: { file: string; name: string; tags: TableTag[] }[];
  tags: TableTagDefinition[];
}

export interface BundleSet {
  name: string;
  markdown: string;
  document?: CustomSetDocument;
  tags: TableTag[];
}

function slugFor(name: string, taken: Set<string>) {
  const base =
    name
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "set";
  let slug = base;
  for (let suffix = 2; taken.has(slug); suffix += 1) slug = `${base}-${suffix}`;
  taken.add(slug);
  return slug;
}

export function buildBundle(sets: readonly BundleSet[], tags: readonly TableTagDefinition[]): Uint8Array {
  const taken = new Set<string>();
  const files: Record<string, Uint8Array> = {};
  const manifest: BundleManifest = {
    bundleVersion: sets.some((set) => set.document) ? BUNDLE_VERSION : 1,
    exportedAt: new Date().toISOString(),
    app: "devils-tables",
    sets: [],
    tags: [...tags]
  };

  for (const set of sets) {
    const json = Boolean(set.document);
    const file = `sets/${slugFor(set.name, taken)}.${json ? "json" : "md"}`;
    files[file] = strToU8(json ? `${JSON.stringify(set.document, null, 2)}\n` : set.markdown);
    manifest.sets.push({ file, name: set.name, tags: [...set.tags] });
  }
  files["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  return zipSync(files, { level: 6 });
}

export interface ReadBundle {
  sets: BundleSet[];
  tags: TableTagDefinition[];
}

/** Reads a bundle, refusing anything that is not one rather than half-importing it. */
export function readBundle(archive: Uint8Array, vocabulary: readonly TableTagDefinition[]): ReadBundle {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archive);
  } catch {
    throw new Error("That file is not a readable zip archive.");
  }

  const manifestFile = files["manifest.json"];
  if (!manifestFile) throw new Error("The archive has no manifest.json, so it is not a table bundle.");

  let manifest: BundleManifest;
  try {
    manifest = JSON.parse(strFromU8(manifestFile));
  } catch {
    throw new Error("The bundle's manifest.json could not be read.");
  }
  if (manifest.app !== "devils-tables") throw new Error("That bundle was not written by The Devil's Tables.");
  if (manifest.bundleVersion > BUNDLE_VERSION)
    throw new Error(`That bundle was written by a newer version (${manifest.bundleVersion}). Update this one first.`);
  if (!Array.isArray(manifest.sets)) throw new Error("The bundle's manifest lists no sets.");

  const tags = Array.isArray(manifest.tags)
    ? manifest.tags.filter((tag) => tag && typeof tag.slug === "string" && typeof tag.label === "string")
    : [];
  const effectiveVocabulary = [...vocabulary];
  for (const tag of tags) {
    if (!effectiveVocabulary.some((entry) => entry.slug === tag.slug)) effectiveVocabulary.push(tag);
  }

  const sets: BundleSet[] = [];
  for (const entry of manifest.sets) {
    const file = files[entry.file];
    if (!file) throw new Error(`The bundle names "${entry.file}" but does not contain it.`);
    const name = String(entry.name ?? "Untitled set").slice(0, 80);
    const tags = Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === "string") : [];
    if (manifest.bundleVersion <= 1 || entry.file.toLocaleLowerCase().endsWith(".md")) {
      sets.push({ name, markdown: strFromU8(file), tags });
    } else {
      try {
        sets.push({ name, markdown: "", document: parseCustomSet(strFromU8(file), name, effectiveVocabulary), tags });
      } catch {
        throw new Error(`The bundle's table JSON for "${name}" could not be read.`);
      }
    }
  }

  return { sets, tags };
}

/** Canonical Markdown for legacy JSON bundle inputs, which have no source ranges to preserve. */
export function bundleSetMarkdown(set: BundleSet) {
  if (!set.document) return set.markdown;
  const body = serializeSet(set.document.tables, set.name).trim();
  return [set.document.preamble.trim(), body, set.document.postamble.trim()].filter(Boolean).join("\n\n") + "\n";
}

/**
 * A set shaped for `raw/`, with instructions written against the paths and
 * constants as they actually are, so the merge does not depend on remembering
 * how the application loads a system catalogue.
 */
export function buildRepoBundle(name: string, tables: readonly RollTable[], tags: readonly TableTag[]): Uint8Array {
  const filename = `${name.replace(/[^A-Za-z0-9 _-]/g, "").trim() || "Tables"}.md`;
  const slug =
    name
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "tables";
  const quoted = [...tags].map((tag) => `"${tag}"`).join(", ");

  const instructions = `# Merging "${name}" into the repository

This archive holds one file, \`raw/${filename}\`, written the way the table parser
reads the rulebooks. Table tags travel with it in \`<!-- tags: ... -->\` comments.

There are two ways to use it.

## As extra tables for a system that already exists

Append the contents of \`raw/${filename}\` to the Markdown file named by the target system's
\`sourceDocuments\` entry. Nothing else changes: the parser picks the tables up
on the next start, and they inherit that system's catalogue tags.

## As a catalogue of its own

1. Copy \`raw/${filename}\` into the repository's \`raw/\` folder.
2. Create \`systems/${slug}/\` beside \`systems/cairn/\`, copying its \`package.json\`
   and \`src/index.ts\`. Give the new system a \`sourceDocuments\` entry and this catalogue:

\`\`\`ts
tableCatalog: {
  label: "${name}",
  exclude: [],
  tags: [${quoted}]
}
\`\`\`

3. Register it in \`server/src/systems.ts\`:

\`\`\`ts
export const systems = { cairn, monolith, ${slug} } as const;
\`\`\`

4. Add the workspace to the root \`package.json\` if it is not covered by
   \`systems/*\`, and add \`COPY systems/${slug}/package.json systems/${slug}/package.json\`
   to the \`Dockerfile\`. The line \`COPY --from=build /app/raw/*.md ./raw/\` already
   carries the Markdown.
5. Describe reusable rules in \`contentModules\` with stable capability names and storage namespaces. Leave \`imports\` empty until a compatible source system is intentionally enabled; source loading follows \`sourceDocuments\` automatically.

## Checking it worked

\`\`\`bash
npm run build && npm run smoke
\`\`\`

${tables.length} table${tables.length === 1 ? "" : "s"} were exported${tags.length ? `, tagged ${[...tags].join(", ")}` : ""}.
`;

  return zipSync(
    {
      [`raw/${filename}`]: strToU8(serializeSet(tables, name)),
      "MERGE.md": strToU8(instructions)
    },
    { level: 6 }
  );
}

/** How a set in a bundle relates to what this instance already holds. */
export type ImportStatus = "new" | "identical" | "conflict";

export function compareToExisting(
  incoming: readonly BundleSet[],
  existing: readonly { name: string; markdown: string }[]
) {
  return incoming.map((set) => {
    const match = existing.find((entry) => entry.name.toLocaleLowerCase() === set.name.toLocaleLowerCase());
    const markdown = bundleSetMarkdown(set);
    const status: ImportStatus = !match ? "new" : match.markdown === markdown ? "identical" : "conflict";
    return {
      name: set.name,
      tags: set.tags,
      status,
      tables: parseRollTables(markdown).length
    };
  });
}
