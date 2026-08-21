import fs from "node:fs";
import path from "node:path";
import {
  CREATION_NAME_KEY,
  SYSTEM_CREATION_STEPS,
  creationStepDice,
  creationStepFieldKeys,
  creationStepListKeys,
  creationStepPacketTables,
  creationStepReadKeys,
  creationStepRollSources,
  creationStepRolls,
  creationStepTables,
  creationSteps,
  type CreationStep,
  type GameSystem,
  type SystemId
} from "@devils-toys/shared";
import { config } from "./config.js";
import { isBuiltinSystem } from "./builtin-systems.js";
import { creationPacketSections } from "./character-creation.js";
import { installedSystemRoot, systemRulesFile, systemTablesJsonFile } from "./system-content.js";
import { readItemCatalog } from "./item-catalog.js";
import { readTraitCatalog } from "./trait-catalog.js";
import { systemOrThrow } from "./systems.js";
import { gameSystemSchema } from "./system-schema.js";
import {
  buildSystemBundle,
  renameSystem,
  type SystemBundleContent,
  type SystemReleaseInput
} from "./system-bundles.js";
import { parseSetJson, readSetJson } from "./table-json.js";
import { rollDice } from "./dice.js";

/**
 * Putting a bundle on disk and taking one back off it.
 *
 * The write is staged and then renamed, so a bundle that fails halfway leaves
 * nothing behind and never half-replaces a system a room is in the middle of
 * using. Everything a bundle carries has already been validated in memory by
 * the reader it arrived through before any of this runs.
 */

/** Reads everything a registered system is made of, ready to be bundled. */
export function systemContentFor(system: SystemId): SystemBundleContent {
  const definition = systemOrThrow(system);
  const rules: Record<string, string> = {};
  const tables: Record<string, string> = {};
  for (const source of definition.sourceDocuments) {
    rules[source.markdownFile] = fs.readFileSync(systemRulesFile(system, source.markdownFile), "utf8");
    // The corrections ledger travels with the book it corrects, since a bundle
    // that dropped it would lose the record of what was repaired and why.
    if (source.correctionsFile) {
      const file = systemRulesFile(system, source.correctionsFile);
      if (fs.existsSync(file)) rules[source.correctionsFile] = fs.readFileSync(file, "utf8");
    }
    if (source.tablesFile)
      tables[source.tablesFile] = fs.readFileSync(systemTablesJsonFile(system, source.tablesFile), "utf8");
  }
  return {
    system: definition,
    items: readItemCatalog(system),
    traits: readTraitCatalog(system),
    rules,
    tables
  };
}

export interface ExportOptions extends SystemReleaseInput {
  /** Write the bundle under a different id, rewriting everything namespaced by the old one. */
  as?: string;
  /** A name for the renamed system, so the two are distinguishable in a picker. */
  name?: string;
}

export function exportSystemBundle(system: SystemId, options: ExportOptions = {}): Uint8Array {
  const content = systemContentFor(system);
  return buildSystemBundle(options.as ? renameSystem(content, options.as, options.name) : content, options);
}

export interface InstallResult {
  system: SystemId;
  name: string;
  /** True when a system of this id was already installed and has been replaced. */
  replaced: boolean;
  licenses: string[];
}

/**
 * Checks a bundle against what this server can actually do with it, beyond what
 * the schema can see on its own. Each of these is a message an author can act
 * on, which is why they are separate rather than one "invalid bundle".
 */
export function refuseUninstallableBundle(bundle: Pick<SystemBundleContent, "system">) {
  const { system } = bundle;

  if (isBuiltinSystem(system.id))
    throw new Error(`"${system.id}" is a system this application ships. Give the bundle another id.`);

  const listKeys = system.characterSheet.lists.map((list) => list.key);
  const duplicate = listKeys.find((key, index) => listKeys.indexOf(key) !== index);
  if (duplicate) throw new Error(`The sheet declares two lists called "${duplicate}".`);

  const statblockKeys = new Set(system.npcStatblock.fields.map((field) => field.key));
  if (!statblockKeys.has(system.npcStatblock.hitPointsKey))
    throw new Error(
      `npcStatblock.hitPointsKey is "${system.npcStatblock.hitPointsKey}", which is not one of its declared fields.`
    );
  if (system.npcStatblock.armorKey && !statblockKeys.has(system.npcStatblock.armorKey))
    throw new Error(`npcStatblock.armorKey is "${system.npcStatblock.armorKey}", which is not one of its fields.`);

  // A warning rule naming a field nothing writes can never fire, which is a
  // silent failure rather than a loud one — so it is refused at the door.
  const sheetKeys = new Set([
    ...system.characterSheet.sections.flatMap((section) => section.fields.map((field) => field.key)),
    ...listKeys
  ]);
  for (const rule of system.warningRules) {
    const referenced =
      rule.kind === "list-occupancy" ? [rule.listKey] : [rule.key, ...("against" in rule ? [rule.against] : [])];
    for (const key of referenced)
      if (!sheetKeys.has(key))
        throw new Error(`A warning rule reads "${key}", which is not a field or list the sheet declares.`);
  }

  const documentIds = new Set(system.sourceDocuments.map((source) => source.id));
  for (const module of system.contentModules)
    if (!documentIds.has(module.sourceDocumentId))
      throw new Error(
        `Content module "${module.id}" names source document "${module.sourceDocumentId}", which the bundle does not have.`
      );
}

/** Names in a book are matched however they were cased or spaced, as the roller matches them. */
const folded = (value: string) => value.trim().toLocaleLowerCase();

/**
 * What a creation step puts in a field, and the field kinds that can hold it.
 *
 * Knowing a key exists is not the same as knowing the box behind it can hold
 * what the step is about to put there. A rolled vice written as text into a
 * `vices` field is the standing example: the key is real, the install passes,
 * and the player gets an empty panel, because a `vices` field holds records and
 * not a line of prose.
 *
 * Deliberately permissive where a book might reasonably differ. A number reads
 * perfectly well in a text box, and a table result reads perfectly well in a
 * `textarea`; what is refused is only what cannot work at all.
 */
const CREATION_WRITES = {
  /** A rolled total, a derived value, or a constant. */
  number: { as: "a number", kinds: ["number", "text", "textarea"] },
  /** One line: a section's name, a typed field, a constant string, a join with no line breaks. */
  line: { as: "a line of text", kinds: ["text", "textarea"] },
  /** Several lines: a multiline typed field, or a join whose separator holds a line break. */
  lines: { as: "text with line breaks in it", kinds: ["textarea"] },
  /** A constant true or false, which only a switch holds. */
  flag: { as: "a yes or a no", kinds: ["checkbox"] },
  /** A row off a table: its text where the sheet keeps text, its record where the sheet keeps records. */
  result: { as: "a rolled table result", kinds: ["text", "textarea", "vices"] }
} as const;

type CreationWriteShape = keyof typeof CREATION_WRITES;

/**
 * The character's own name is a column on the row rather than a field on the
 * sheet, so it has no declared kind — but it is still one line of text, and a
 * step joining paragraphs into it is as broken as one joining them into a
 * single-line field.
 */
const NAME_HOLDS: readonly CreationWriteShape[] = ["number", "line", "result"];

/** A `joinInto` writes one field, in as many lines as its separator implies. */
const joinShape = (join: { separator: string }): CreationWriteShape =>
  /\n|\r/.test(join.separator) ? "lines" : "line";

/** Every field a step writes, paired with the shape of what it writes there. */
function creationFieldWrites(step: CreationStep) {
  const writes: { key: string; shape: CreationWriteShape }[] = [];
  const add = (key: string, shape: CreationWriteShape) => writes.push({ key, shape });
  switch (step.kind) {
    case "roll-scores":
      for (const score of step.scores) {
        add(score.currentKey, "number");
        if (score.maximumKey) add(score.maximumKey, "number");
      }
      break;
    case "roll-table":
      for (const entry of step.tables) if (entry.field) add(entry.field, "result");
      if (step.joinInto) add(step.joinInto.field, joinShape(step.joinInto));
      break;
    case "packet":
      if (step.into?.field) add(step.into.field, "line");
      if (step.into?.joinInto) add(step.into.joinInto.field, joinShape(step.into.joinInto));
      break;
    case "grant":
      for (const roll of step.roll ?? []) add(roll.field, "number");
      if (step.describeInto) add(step.describeInto.field, joinShape(step.describeInto));
      break;
    case "derive":
      for (const derivation of step.derive) add(derivation.key, "number");
      break;
    case "set":
      for (const [key, value] of Object.entries(step.values))
        add(key, typeof value === "boolean" ? "flag" : typeof value === "number" ? "number" : "line");
      break;
    case "text":
      add(step.field, step.multiline ? "lines" : "line");
      break;
    case "save":
    case "rules":
      break;
  }
  return writes;
}

/**
 * Checks a creation declaration against the rest of the bundle it will be
 * performed over — the sheet it writes, the lists it stows into, the tables it
 * rolls on, the headings it enumerates, and the saves it makes.
 *
 * A system's rules and tables travel inside the bundle, so a renamed heading or
 * a mistyped column is caught here rather than by a player looking at a screen
 * with an empty box on it. Every refusal names the step it came from, because
 * the author's next action is to open that step.
 */
export function refuseUninstallableCreation(bundle: SystemBundleContent) {
  const { system } = bundle;
  const fieldKeys = new Set(
    system.characterSheet.sections.flatMap((section) => section.fields.map((field) => field.key))
  );

  // Reserved whether or not this system declares any creation at all: the name
  // is a column on the row, and a field of the same spelling would be shadowed
  // by it the day the system gained a step that writes one.
  if (fieldKeys.has(CREATION_NAME_KEY))
    throw new Error(
      `The sheet declares a field called "${CREATION_NAME_KEY}", which is how a creation step names the character's own name.`
    );

  const creation = system.characterCreation;
  if (!creation) return;

  // Before anything reads a step: everything below decides what to check by
  // asking what kind a step is, and there is nothing sensible to ask of a kind
  // this build has never heard of.
  for (const step of creation.steps.flatMap((step) => ("then" in step && step.then ? [step, ...step.then] : [step])))
    if (!(SYSTEM_CREATION_STEPS as readonly string[]).includes(step.kind))
      throw new Error(
        `Creation step "${step.id}" is of kind "${step.kind}", which this build has no way to perform. The kinds are ${SYSTEM_CREATION_STEPS.join(", ")}.`
      );

  const steps = creationSteps(creation);

  const seen = new Set<string>();
  for (const step of steps) {
    if (seen.has(step.id))
      throw new Error(
        `Two creation steps share the id "${step.id}"; a half-built character records what it has done against those ids.`
      );
    seen.add(step.id);
  }

  const listKeys = new Set(system.characterSheet.lists.map((list) => list.key));
  for (const step of steps) {
    if (step.kind === "roll-table" && step.editable && !step.joinInto)
      throw new Error(`Creation step "${step.id}" is editable but has no joined field for the custom value.`);
    // The character's own name is a column on the row rather than a field on
    // the sheet, and is the one target a step may write that the sheet has not
    // got. Nothing may read it.
    for (const key of creationStepFieldKeys(step))
      if (key !== CREATION_NAME_KEY && !fieldKeys.has(key))
        throw new Error(`Creation step "${step.id}" writes "${key}", which is not a field the sheet declares.`);
    for (const key of creationStepReadKeys(step))
      if (!fieldKeys.has(key))
        throw new Error(`Creation step "${step.id}" reads "${key}", which is not a field the sheet declares.`);
    for (const key of creationStepListKeys(step))
      if (!listKeys.has(key))
        throw new Error(
          step.kind === "derive"
            ? `Creation step "${step.id}" reads armor from "${key}", which is not a list the sheet declares.`
            : `Creation step "${step.id}" stows into "${key}", which is not a list the sheet declares.`
        );
  }

  // Having a key is not having a box that can hold what is about to go in it.
  // The kinds above are what each field actually renders as, and a step writing
  // past one of them is a screen that draws an empty panel rather than a screen
  // that fails — which is the failure this application refuses at the door
  // everywhere else it can.
  const kindByKey = new Map(
    system.characterSheet.sections.flatMap((section) => section.fields.map((field) => [field.key, field.kind] as const))
  );
  for (const step of steps)
    for (const { key, shape } of creationFieldWrites(step)) {
      const write = CREATION_WRITES[shape];
      if (key === CREATION_NAME_KEY) {
        if (!NAME_HOLDS.includes(shape))
          throw new Error(
            `Creation step "${step.id}" writes ${write.as} to the character's own name, which is one line and nothing else.`
          );
        continue;
      }
      const kind = kindByKey.get(key);
      if (kind === undefined || (write.kinds as readonly string[]).includes(kind)) continue;
      throw new Error(
        `Creation step "${step.id}" writes ${write.as} to "${key}", which the sheet keeps as ${
          kind === "entries" ? "entries — no creation step produces one" : `a ${kind} field`
        }.`
      );
    }

  // An array is assigned across the scores it is offered for, one number each.
  // A book printing six numbers for five scores has printed one of them wrong,
  // and the screen that cannot place them all is a poor place to find out.
  for (const step of steps)
    if (step.kind === "roll-scores" && step.array && step.array.values.length !== step.scores.length)
      throw new Error(
        `Creation step "${step.id}" offers ${step.array.values.length} numbers to assign across ${step.scores.length} scores.`
      );

  // The bundle's own tables, read with the parser the install verifies them
  // with, so a declaration cannot name a table the book does not have.
  const columnsByTable = new Map<string, readonly string[]>();
  const allTables: { name: string; section: string; columns: readonly string[] }[] = [];
  for (const source of system.sourceDocuments) {
    if (!source.tablesFile) continue;
    const json = bundle.tables[source.tablesFile];
    if (json === undefined) throw new Error(`The bundle names tables/${source.tablesFile} but does not contain it.`);
    for (const table of parseSetJson(json, source.tablesFile).tables) {
      columnsByTable.set(folded(table.name), table.columns ?? []);
      allTables.push({ name: table.name, section: table.section, columns: table.columns ?? [] });
    }
  }
  for (const step of steps)
    for (const { table, column } of creationStepTables(step)) {
      const columns = columnsByTable.get(folded(table));
      if (!columns)
        throw new Error(`Creation step "${step.id}" rolls on "${table}", which is not a table the bundle has.`);
      if (column !== undefined && !columns.some((name) => folded(name) === folded(column)))
        throw new Error(
          `Creation step "${step.id}" reads the "${column}" column of "${table}", which that table has not got.`
        );
    }

  // A table selected through a packet cannot be named until the player has
  // chosen that packet's section. Check the relationship rather than every
  // table by one fixed name: the source must be an earlier packet, and every
  // section it can choose must own the requested table position and column.
  for (const [index, step] of steps.entries())
    for (const reference of creationStepPacketTables(step)) {
      const sourceIndex = steps.findIndex((candidate) => candidate.id === reference.fromPacket);
      const packet = steps[sourceIndex];
      if (sourceIndex < 0 || sourceIndex >= index || packet?.kind !== "packet")
        throw new Error(
          `Creation step "${step.id}" reads a table from "${reference.fromPacket}", which is not a packet before it.`
        );
      const sections = Object.values(bundle.rules).flatMap((markdown) =>
        creationPacketSections(markdown, packet.under)
      );
      for (const section of sections) {
        const owned = allTables.filter((table) => {
          const path = table.section.split(/\s*·\s*/).map((part) => part.trim());
          const under = path.findIndex((part) => folded(part) === folded(packet.under));
          return under >= 0 && folded(path[under + 1] ?? "") === folded(section.name);
        });
        const table = owned[reference.position - 1];
        if (!table)
          throw new Error(
            `Creation step "${step.id}" reads table ${reference.position} from "${section.name}", which has only ${owned.length}.`
          );
        if (reference.column && !table.columns.some((column) => folded(column) === folded(reference.column ?? "")))
          throw new Error(
            `Creation step "${step.id}" reads the "${reference.column}" column of packet table "${table.name}", which that table has not got.`
          );
      }
    }

  const headings = new Set(
    Object.values(bundle.rules).flatMap((markdown) =>
      [...markdown.matchAll(/^#{1,6}[ \t]+(.+?)[ \t]*$/gm)].map((match) => folded(match[1].replace(/^\*+|\*+$/g, "")))
    )
  );
  for (const step of steps) {
    if (step.kind !== "packet") continue;
    if (!headings.has(folded(step.under)))
      throw new Error(
        `Creation step "${step.id}" names the heading "${step.under}", which the bundle's rules do not have.`
      );
    // `prose` and `grantFrom` are read out of a section rather than out of the
    // book, so this asks where the packet will actually look. Cairn's Optional
    // Gear Packages are ten headings with bullets directly beneath them and no
    // sub-headings at all: a packet naming `grantFrom: "Starting Gear"` passes
    // an "exists anywhere" test — that heading is real, elsewhere — and then
    // offers ten names and an empty checklist to every player, forever.
    const beneath = new Set(
      Object.values(bundle.rules)
        .flatMap((markdown) => creationPacketSections(markdown, step.under))
        .flatMap((section) => section.headings.map(folded))
    );
    for (const heading of [step.prose, step.grantFrom])
      if (heading !== undefined && !beneath.has(folded(heading)))
        throw new Error(
          `Creation step "${step.id}" reads "${heading}" out of the sections under "${step.under}", and none of them has a heading of that name.`
        );
  }

  const saveTypes = new Set(system.dice.save.types.map((type) => type.id));
  for (const step of steps)
    if (step.kind === "save" && !saveTypes.has(step.type))
      throw new Error(
        `Creation step "${step.id}" makes a "${step.type}" save, which is not one of the save types the system declares.`
      );

  // The roller is the authority on what a dice expression is — how many dice it
  // will throw and which sides it knows — so a declaration's dice are checked by
  // handing them to it rather than by keeping a second grammar here that could
  // drift from it. `SUPPORTED_DIE_SIDES` has no d3, so a book with three
  // backgrounds finds out here rather than at the screen that cannot roll them.
  for (const step of steps)
    for (const expression of creationStepDice(step)) {
      try {
        rollDice(expression, () => 0);
      } catch (cause) {
        throw new Error(
          `Creation step "${step.id}" rolls "${expression}", which this build cannot roll: ${
            cause instanceof Error ? cause.message : "unusable expression."
          }`
        );
      }
    }

  // A total is rolled once and read twice, so the step it is read from has to
  // have run already and has to have rolled something.
  for (const [index, step] of steps.entries())
    for (const source of creationStepRollSources(step)) {
      const from = steps.findIndex((candidate) => candidate.id === source);
      if (from < 0 || from >= index)
        throw new Error(`Creation step "${step.id}" takes its total from "${source}", which is not a step before it.`);
      if (!creationStepRolls(steps[from]))
        throw new Error(`Creation step "${step.id}" takes its total from "${source}", which rolls no die of its own.`);
    }

  // A gear review copies decisions already made. Reading forward would make its
  // contents depend on a step the player has not reached yet.
  for (const [index, step] of steps.entries()) {
    if (step.kind !== "grant") continue;
    if (step.describeInto && !step.reviewFrom?.length)
      throw new Error(`Creation step "${step.id}" describes reviewed gear but reviews no earlier step.`);
    for (const source of step.reviewFrom ?? []) {
      const from = steps.findIndex((candidate) => candidate.id === source);
      if (from < 0 || from >= index)
        throw new Error(`Creation step "${step.id}" reviews gear from "${source}", which is not a step before it.`);
    }
  }

  // Automatic work is a finishing pass, not a branch inside a save. A nested
  // automatic step could run even when its branch never opened.
  for (const step of creation.steps)
    if (step.kind === "save" && step.then.some((nested) => "automatic" in nested && nested.automatic))
      throw new Error(`Creation step "${step.id}" has an automatic step inside its conditional branch.`);
}

/**
 * Writes a validated bundle into the data directory.
 *
 * Staged under a sibling directory and renamed into place, so an interrupted
 * install leaves the previous content untouched rather than a half-written
 * system that would fail to load on the next start.
 */
export function writeSystemBundle(bundle: SystemBundleContent): InstallResult {
  const { system, items, traits, rules, tables } = bundle;
  const root = installedSystemRoot(system.id);
  const staging = `${root}.incoming`;
  const retired = `${root}.replaced`;

  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(path.join(staging, "rules"), { recursive: true });
  fs.mkdirSync(path.join(staging, "tables"), { recursive: true });

  try {
    fs.writeFileSync(path.join(staging, "system.json"), `${JSON.stringify(system, null, 2)}\n`);
    fs.writeFileSync(path.join(staging, "items.json"), `${JSON.stringify(items, null, 2)}\n`);
    fs.writeFileSync(path.join(staging, "traits.json"), `${JSON.stringify(traits, null, 2)}\n`);
    for (const [name, markdown] of Object.entries(rules)) fs.writeFileSync(path.join(staging, "rules", name), markdown);
    for (const [name, json] of Object.entries(tables)) fs.writeFileSync(path.join(staging, "tables", name), json);

    const replaced = fs.existsSync(root);
    if (replaced) {
      fs.rmSync(retired, { recursive: true, force: true });
      fs.renameSync(root, retired);
    }
    try {
      fs.renameSync(staging, root);
    } catch (error) {
      if (replaced && fs.existsSync(retired)) {
        try {
          fs.renameSync(retired, root);
        } catch {
          // Keep the install error: it is the failure the caller can act on.
        }
      }
      throw error;
    }
    fs.rmSync(retired, { recursive: true, force: true });
    return {
      system: system.id,
      name: system.name,
      replaced,
      licenses: [...new Set(system.sourceDocuments.map((source) => source.license))]
    };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/** Removes an installed system's content. A built-in has none of its own to remove. */
export function removeSystemContent(system: SystemId) {
  if (isBuiltinSystem(system)) return false;
  const root = installedSystemRoot(system);
  if (!fs.existsSync(root)) return false;
  fs.rmSync(root, { recursive: true, force: true });
  return true;
}

/** Every system whose content is on disk under the data directory. */
export function installedSystemIds(): string[] {
  const root = path.join(config.dataDir, "systems");
  if (!fs.existsSync(root)) return [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith(".replaced")) continue;
    const system = entry.name.slice(0, -".replaced".length);
    const destination = path.join(root, system);
    if (!fs.existsSync(destination)) fs.renameSync(path.join(root, entry.name), destination);
  }
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.includes("."))
    .map((entry) => entry.name);
}

/**
 * Reads an installed system's definition back off disk, through the same schema
 * an upload goes through. A file edited by hand between restarts is no more
 * trusted than one that arrived over HTTP.
 */
export function readInstalledSystem(system: SystemId): GameSystem {
  const file = path.join(installedSystemRoot(system), "system.json");
  const result = gameSystemSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")) as unknown);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`${file} is not a valid system — ${issue.path.join(".")}: ${issue.message}`);
  }
  return result.data as GameSystem;
}

/**
 * Confirms a system's tables parse, which `readSetJson` is the authority on.
 * Run at install time so a malformed set is a rejected upload rather than a
 * table that fails to roll at the worst moment.
 */
export function verifySystemTables(system: SystemId, definition: GameSystem, tables?: Record<string, string>) {
  for (const source of definition.sourceDocuments) {
    if (!source.tablesFile) continue;
    if (tables) {
      const table = tables[source.tablesFile];
      if (table === undefined) throw new Error(`The bundle names tables/${source.tablesFile} but does not contain it.`);
      parseSetJson(table, source.tablesFile);
    } else {
      readSetJson(system, source.tablesFile);
    }
  }
}
