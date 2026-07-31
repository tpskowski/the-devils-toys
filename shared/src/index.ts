export * from "./roll-tables.js";
export * from "./table-csv.js";
export * from "./table-markdown.js";
export * from "./table-tags.js";

export const SYSTEM_IDS = ["cairn", "monolith", "cwn"] as const;
export const THEME_IDS = ["heroic", "digital", "used", "grim", "shinji"] as const;

export type SystemId = (typeof SYSTEM_IDS)[number];
export type ThemeId = (typeof THEME_IDS)[number];
export type RoomRole = "gm" | "player";
export type AccountRole = "admin" | "gm" | "player";

export interface Account {
  id: number;
  username: string;
  isAdmin: boolean;
  role: AccountRole;
}

export interface RoomSummary {
  id: number;
  name: string;
  system: SystemId;
  theme: ThemeId;
  role: RoomRole;
  archived: boolean;
}

export type MediaKind = "map" | "scene" | "reference" | "audio";

export interface MediaAsset {
  id: number;
  roomId: number;
  kind: MediaKind;
  filename: string;
  displayName?: string | null;
  artist?: string | null;
  title?: string | null;
  mimeType: string;
  size: number;
  visible: boolean;
  createdAt: string;
  url: string;
}

export type AudioRepeatMode = "off" | "all" | "one";

export interface AudioPlaybackState {
  trackId: number | null;
  playing: boolean;
  position: number;
  repeat: AudioRepeatMode;
  shuffle: boolean;
  updatedAt: string;
}

export interface RoomAudioState {
  tracks: MediaAsset[];
  playback: AudioPlaybackState;
}

export interface ChatMessage {
  id: number;
  roomId: number;
  accountId: number;
  username: string;
  displayName: string;
  kind: "chat" | "roll" | "system";
  body: string;
  detail?: string;
  private?: boolean;
  createdAt: string;
}

export interface PresenceMember {
  accountId: number;
  username: string;
  displayName: string;
  activeCharacterId: number | null;
  role: RoomRole;
  online: boolean;
}
export type CharacterFieldKind = "text" | "number" | "checkbox" | "textarea" | "entries" | "vices";

/** One item of an `entries` field: a short title and free-form rules text. */
export interface CharacterEntry {
  title: string;
  text: string;
}

/** A Monolith vice, retaining each column of the authoritative VICES table. */
export interface CharacterVice {
  name: string;
  triggers: string;
  satisfying: string;
  custom?: boolean;
}

export interface CharacterFieldDefinition {
  key: string;
  label: string;
  kind: CharacterFieldKind;
  placeholder?: string;
  /** A number field that can open a configured system roll with this value as its target. */
  roll?: {
    kind: "save";
    label: string;
  };
}

export interface CharacterSheetSection {
  id: string;
  label: string;
  layout?: "paired-current-max";
  fields: readonly CharacterFieldDefinition[];
}

export interface CharacterListDefinition {
  key: string;
  label: string;
  slots: readonly string[];
  /** Slot indexes that begin a new group of slots, drawn starting on a fresh row. */
  groupStarts?: readonly number[];
  /** Show only filled slots on the sheet and edit the full set in a dialog. */
  editInDialog?: boolean;
  /** Rules headings whose priced tables stock this list's picker. */
  itemHeadings?: readonly string[];
  /** Categories under those headings that are not things a character carries. */
  skipCategories?: readonly string[];
}

/** One entry from a system's priced tables, offered when filling a slot. */
export interface CharacterItem {
  category: string;
  name: string;
  /** The parenthetical the book gives, such as "D8, bulky" or "Armor 2". */
  spec: string;
  detail: string;
  cost: string;
  bulky: boolean;
  /** What goes in the slot: the name with its spec, as the book writes it. */
  label: string;
}

export interface CharacterSheetDefinition {
  sections: readonly CharacterSheetSection[];
  lists: readonly CharacterListDefinition[];
}

export interface GroupFieldDefinition extends CharacterFieldDefinition {
  rulesQuery?: string;
}

export interface GroupSheetSection {
  id: string;
  label: string;
  fields: readonly GroupFieldDefinition[];
}

/** A hull class a ship can be built at, and the stats that class fixes. */
export interface StarshipSizeDefinition {
  id: string;
  label: string;
  /** Holds of this size, which is its capacity for parts and cargo. */
  holds: number;
  /** Sheet values the size decides, reapplied whenever the size changes. */
  fixed: Readonly<Record<string, string | number>>;
  /** A short reminder of the class, shown once it is chosen. */
  note?: string;
}

/** One installable part, read from the system's own parts list. */
export interface StarshipPart {
  category: string;
  name: string;
  /** The parenthetical the book gives, such as "D10, bulky" or "+2 HUL". */
  spec: string;
  detail: string;
  cost: string;
  /** Bulky parts take two holds. */
  bulky: boolean;
  /** What goes in the hold: the name with its spec, as the book writes it. */
  label: string;
}

export interface StarshipSheetDefinition extends CharacterSheetDefinition {
  sizes?: readonly StarshipSizeDefinition[];
  /**
   * What every ship of any size starts with. Applied only where the sheet is
   * blank, so choosing a size never discards scores raised by modules.
   */
  baseValues?: Readonly<Record<string, string | number>>;
  /** Which list holds installable parts, and the parts on offer for it. */
  partsList?: string;
  parts?: readonly StarshipPart[];
}

export interface GroupPageDefinition {
  sections: readonly GroupSheetSection[];
  hirelings?: {
    label: string;
    placeholder: string;
  };
  starshipSheet?: StarshipSheetDefinition;
}

export type SavePosition = "normal" | "advantage" | "disadvantage";

export interface SaveOutcomeLabels {
  success: string;
  failure: string;
}

export interface DiceRules {
  save: {
    sides: 20;
    success: "equal-or-under" | "equal-or-over";
    automaticSuccess: number;
    automaticFailure: number;
    /** Save choices shown by the dice builder when a roll is not launched from the sheet. */
    types: readonly { id: string; label: string }[];
    outcomes: {
      normal: SaveOutcomeLabels;
      advantage?: SaveOutcomeLabels;
      disadvantage?: SaveOutcomeLabels;
    };
  };
  /** Cairn-family damage positions. Omit for systems that roll ordinary weapon damage. */
  damage?: {
    impairedSides: 4;
    enhancedSides: 12;
    multipleRolls: "keep-highest";
  };
  /** A named check preset in addition to the free-form dice builder. */
  skillCheck?: {
    dice: "2d6";
    success: "equal-or-over";
    defaultDifficulty: number;
    label: string;
  };
}

export interface SystemSourceDocument {
  /** Stable within the owning system package. */
  id: string;
  /** Runtime source read by the application. */
  markdownFile: string;
  /** Canonical source used to audit the Markdown conversion. */
  canonicalFile?: string;
  /** Human-readable ledger of intentional differences from the canonical source. */
  correctionsFile?: string;
  license: string;
}

export interface SystemCompatibility {
  family: string;
  version: number;
}

/**
 * A compiled, provenance-aware slice of a system. Imports are deliberately
 * declarations rather than runtime installation: a future system can reference
 * a compatible module and the application can compose it at build time.
 */
export interface GameSystemContentModule {
  /** Globally stable, namespaced id such as "cwn/cyberware". */
  id: string;
  label: string;
  sourceDocumentId: string;
  /** Root headings owned by this module in its source document. */
  rootHeadings: readonly string[];
  classification: RoomRole;
  compatibility?: SystemCompatibility;
  /** Namespace reserved for module-owned character data and anchors. */
  storageNamespace: string;
  provides: readonly string[];
  requires: readonly string[];
  conflictsWith?: readonly string[];
  /** Native sheet fragments this module contributes; useful to a future composer. */
  characterSheet?: {
    sections?: readonly CharacterSheetSection[];
    lists?: readonly CharacterListDefinition[];
  };
}

/** One row of a random table: the die values it covers and its result cells. */
export interface RollTableRow {
  /** The die column exactly as the source writes it, such as "4-14" or "11". */
  label: string;
  min: number;
  max: number;
  cells: readonly string[];
}

/**
 * Where a table sits in the document it was parsed from, so an editor can rewrite
 * one table without re-emitting — and reformatting — everything around it.
 * Line numbers are zero-based and `tableEnd` is inclusive.
 */
export interface RollTableSource {
  /** The heading that owns the table, when the table has one above it. */
  heading: { line: number; level: number; text: string } | null;
  /** The line holding this table's `<!-- tags: ... -->` comment, when it has one. */
  tagsLine: number | null;
  /** The table's header row. */
  tableStart: number;
  /** The table's last row. */
  tableEnd: number;
  /** The die column heading as written, kept so an untouched die is not restyled. */
  dieColumn: string;
  /** The die this table parsed as, for noticing when an edit changes it. */
  dice: string;
  /** Whether the owning heading has exactly one table, so renaming it is unambiguous. */
  soleTable: boolean;
}

export interface RollTable {
  /** Stable within its set; derived from the table's heading path. */
  id: string;
  name: string;
  /** The heading path above the table, for disambiguating repeated names. */
  section: string;
  /** The part of the book this table belongs to, such as "Character Creation". */
  category: string;
  /** A dice expression the server can roll, such as "d20" or "d44". */
  dice: string;
  /** Result column headings; the die column is not included. */
  columns: readonly string[];
  /** Controlled discovery tags applied by the system or custom-set metadata. */
  tags: readonly TableTag[];
  rows: readonly RollTableRow[];
  /** Only present on a freshly parsed table; never sent to the roller. */
  source?: RollTableSource;
}

export type RollTableSummary = Omit<RollTable, "rows" | "source"> & {
  rowCount: number;
  /** Rows written past what the stated die can roll, reported rather than hidden. */
  unreachableRows: number;
};

/**
 * How a table is named in chat and in the roller. Many source headings already
 * carry their die, as "Character Traits (d10)" does, so it is not repeated.
 */
export function rollTableLabel(name: string, dice: string) {
  return new RegExp(`\\(\\s*${dice}\\s*\\)`, "i").test(name) ? name : `${name} (${dice})`;
}

export type RollTableSetOrigin = "system" | "custom";

/**
 * The discovery tags every instance starts with. They are seed data rather than
 * law: the vocabulary lives in the database and is editable, so a tag is any slug
 * the instance knows about.
 */
export const BUILTIN_TABLE_TAGS = [
  "fantasy",
  "scifi",
  "cyberpunk",
  "real-world",
  "character-building",
  "world-building",
  "random-encounter",
  "names",
  "gear",
  "loot"
] as const;

/** @deprecated Use `BUILTIN_TABLE_TAGS`; kept while callers migrate. */
export const TABLE_TAGS = BUILTIN_TABLE_TAGS;

export type BuiltinTableTag = (typeof BUILTIN_TABLE_TAGS)[number];

/** A tag is identified by its slug, so tags added by an instance are first class. */
export type TableTag = string;

/** Lower-case words joined by single hyphens, matching the built-in vocabulary. */
export const TABLE_TAG_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface TableTagDefinition {
  slug: TableTag;
  label: string;
  /** Seeded with the application and protected from deletion. */
  builtin: boolean;
  sortOrder: number;
}

export interface RollTableSet {
  /** "system:cairn" or "custom:12". */
  id: string;
  name: string;
  origin: RollTableSetOrigin;
  tables: readonly RollTableSummary[];
}

/**
 * How much of a table roll the room sees. `public` shows the roll but not the
 * table text, `private` tells players a roll happened, `invisible` tells them
 * nothing, and `reveal` shows everyone the text that was rolled.
 */
export const TABLE_ROLL_VISIBILITIES = ["public", "private", "invisible", "reveal"] as const;

export type TableRollVisibility = (typeof TABLE_ROLL_VISIBILITIES)[number];

export interface TableRollResult {
  setId: string;
  setName: string;
  tableId: string;
  tableName: string;
  dice: string;
  total: number;
  detail: string;
  row: RollTableRow | null;
  /** The row's cells as one line, or an empty string when nothing matched. */
  text: string;
  visibility: TableRollVisibility;
}

export interface GameSystem {
  id: SystemId;
  name: string;
  shortName: string;
  glyph: string;
  defaultTheme: ThemeId;
  tagline: string;
  /** Heading to focus when the dice builder links to this system's rolling rules. */
  rollRulesQuery: string;
  sourceDocuments: readonly SystemSourceDocument[];
  contentModules: readonly GameSystemContentModule[];
  /** Compiled cross-system module references. Empty until imports are supported. */
  imports: readonly string[];
  compatibility?: SystemCompatibility;
  /** What this system calls the group of characters at the table. */
  partyLabel: string;
  characterSheet: CharacterSheetDefinition;
  /** Omit this definition to remove the Group tab for a system. */
  groupPage?: GroupPageDefinition;
  characterWarnings: (sheet: Record<string, unknown>) => string[];
  abilities: readonly string[];
  gmOnlyHeadings: readonly string[];
  npcCatalog: {
    heading: string;
    entryLevel: number;
    exclude: readonly string[];
  };
  /**
   * Random tables are read out of the system's authoritative Markdown rather
   * than restated here; this only records which ones to leave out and how the
   * set is labelled in the table switcher.
   */
  tableCatalog: {
    label: string;
    exclude: readonly string[];
    /** Tags inherited by every table parsed from this system catalog. */
    tags: readonly TableTag[];
  };
  dice: DiceRules;
}
