import type { RangedWeaponIcon, WeaponRangeRules } from "./character-items.js";

export * from "./character-items.js";
export * from "./item-traits.js";
export * from "./roll-tables.js";
export * from "./table-csv.js";
export * from "./table-markdown.js";
export * from "./table-tags.js";
export * from "./calendar.js";

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
  calendarEnabled: boolean;
  mapNotationEnabled: boolean;
}

export const MAP_NOTATION_COLORS = ["#e53935", "#ffb300", "#43a047", "#1e88e5", "#8e24aa", "#f5f5f5"] as const;
export type MapNotationColor = (typeof MAP_NOTATION_COLORS)[number];

interface MapNotationBase {
  id: number;
  color: MapNotationColor;
}

export type MapNotation =
  | (MapNotationBase & { kind: "line"; points: { x: number; y: number }[] })
  | (MapNotationBase & { kind: "label"; x: number; y: number; text: string; fontSize: number })
  | (MapNotationBase & { kind: "box" | "circle"; x: number; y: number; width: number; height: number });

export type NewMapNotation = MapNotation extends infer Notation
  ? Notation extends MapNotation
    ? Omit<Notation, "id">
    : never
  : never;

/** Incremental room events keep map clients synchronized without reloading every notation after each edit. */
export type MapNotationEvent =
  | { type: "map-notation-added"; mediaId: number; notation: MapNotation; clientMutationId?: string }
  | { type: "map-notation-removed"; mediaId: number; notationId: number }
  | { type: "map-notations-cleared"; mediaId: number };

export type CalendarEventCadence = "holiday" | "weekly" | "biweekly" | "monthly";

export interface CalendarEvent {
  id: string;
  name: string;
  cadence: CalendarEventCadence;
  /** One-based day of the month for holidays/monthly events, or day of the week for weekly events. */
  day: number;
  month?: number;
}

export interface RoomCalendar {
  year: number;
  month: number;
  day: number;
  /** Number of advances in one day. One means each advance moves to the next day. */
  segmentsPerDay: number;
  /** Zero-based segment currently in progress. */
  segment: number;
  daysPerWeek: number;
  daysPerMonth: number;
  dayNames: string[];
  monthNames: string[];
  segmentNames: string[];
  events: CalendarEvent[];
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
  rollVisibility?: "private" | "invisible";
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
  /** Stable type for each slot, used when catalogue entries name compatible slots. */
  slotTypes?: readonly string[];
  /** Slot indexes that begin a new group of slots, drawn starting on a fresh row. */
  groupStarts?: readonly number[];
  /** Show only filled slots on the sheet and edit the full set in a dialog. */
  editInDialog?: boolean;
  /** Rules headings whose priced tables stock this list's picker. */
  itemHeadings?: readonly string[];
  /** Categories under those headings that are not things a character carries. */
  skipCategories?: readonly string[];
  /**
   * Categories the book files as weapons. Everything under one is a weapon even
   * without a damage die, which is how a stun gun and a grenade qualify.
   *
   * Read when seeding `items.json` from the book and never again; an entry that
   * comes out wrong is fixed in the catalogue, which is the authority thereafter.
   */
  weaponCategories?: readonly string[];
  /** How this system states a weapon's reach, for reading one off its notation. */
  weaponRange?: WeaponRangeRules;
}

/** One entry from a system's priced tables, offered when filling a slot. */
export interface CharacterItem {
  /**
   * Stable across regenerations, so anything that needs to point at an item —
   * a combatant's weapon, a shop, a loot table — has something to point at that
   * a reformatted rulebook cannot move. Derived from the system and the item's
   * name, because a rename is a content change worth noticing.
   */
  id: string;
  category: string;
  name: string;
  /** The parenthetical the book gives, such as "D8, bulky" or "Armor 2". */
  spec: string;
  detail: string;
  cost: string;
  bulky: boolean;
  /** Something a character attacks with, so combat can offer it as one. */
  weapon: boolean;
  /** The damage the item's parenthetical states, when it states any. */
  damage?: string;
  /** What else that parenthetical says of a weapon, in the book's own words. */
  traits?: readonly string[];
  /** Its reach: `Melee`, the system's own notation, or `unknown`. */
  range?: string;
  /** Slot types named by the item's authoritative parenthetical, when present. */
  allowedSlotTypes?: readonly string[];
  /** What goes in the slot: the name with its spec, as the book writes it. */
  label: string;
}

export interface CharacterSheetDefinition {
  sections: readonly CharacterSheetSection[];
  lists: readonly CharacterListDefinition[];
}

/**
 * A system's gear, resolved once and committed as `systems/<id>/items.json`
 * rather than re-read from the rulebook on every start.
 *
 * The book stays authoritative — the file is generated from it by
 * `npm run build:items`, and a test fails if the two disagree — but the
 * generated file is what the application loads and what everything else
 * references. Parsing at runtime meant a reformatted heading could silently
 * change the catalogue in production with nothing to review; now that shows up
 * as a diff, and every item has an id that survives the reformat.
 *
 * Do not hand-edit the file: it is rewritten wholesale. An entry the parser
 * reads wrongly is corrected in the owning list's `weaponOverrides`.
 *
 * Reached as `@devils-toys/system-<id>/items` rather than through the system
 * definition, because the generator reads those definitions to decide what to
 * write — a definition that carried its own catalogue could not be loaded until
 * the catalogue already existed.
 */
export interface SystemItemCatalog {
  system: SystemId;
  /** The rulebook the entries were read out of. */
  source: string;
  /** Items by the sheet list they stock, matching `CharacterListDefinition.key`. */
  lists: Readonly<Record<string, readonly CharacterItem[]>>;
  /**
   * Ids the catalogue has deliberately dropped — a book row replaced by better
   * entries, say — so seeding never brings them back. Removing an entry without
   * retiring it only lasts until the next `build:items`.
   */
  retired?: readonly string[];
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
    singularLabel: string;
    rulesQuery: string;
    creationHint: string;
    creationRoll?: {
      abilities: readonly {
        currentKey: string;
        maximumKey: string;
        dice: string;
      }[];
      hitProtection: {
        currentKey: string;
        maximumKey: string;
        dice: string;
      };
      weapon: string;
      finishingTouches?: {
        section: string;
        details: readonly string[];
        firstNames: readonly string[];
        lastName: string;
      };
    };
    sheet: CharacterSheetDefinition;
    levelUpHint: string;
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

export type InitiativeModel = "none" | "side" | "individual";

export interface InitiativeRules {
  model: InitiativeModel;
  sides?: readonly { id: string; label: string }[];
  sideOrder?: "fixed" | "roll";
  roll?: { dice: string; modifierFrom?: "best-dex" | "dex"; label: string };
  entrySave?: {
    label: string;
    appliesTo: "party";
    onFailure: "after-opponents" | "skip-first-turn";
    description: string;
  };
  tieBreak?: "party-wins";
  allowIndividualVariant?: boolean;
  note?: string;
}

export interface NpcStatblockField {
  key: string;
  label: string;
  kind: "number" | "text";
  inSummary?: boolean;
}

export interface NpcStatblockDefinition {
  hitPointsKey: string;
  armorKey?: string;
  /** The field holding what the creature attacks with, where the system states one. */
  attacksKey?: string;
  /** How the statblock states an attack's reach, in the system's own words. */
  weaponRange?: WeaponRangeRules;
  fields: readonly NpcStatblockField[];
}

/**
 * The scores damage moves to once hit points run out, as Cairn and Monolith both
 * work. A system that does not spend attributes this way omits the block, and
 * nothing offers to damage them.
 */
export interface AttributeDamageDefinition {
  /** Names the dialog, in the words the system uses. */
  label: string;
  /** One line of why, shown above the scores. */
  note?: string;
  /**
   * The mark a failed save against one of these attributes leaves. Monolith's
   * critical damage is the case: spend past 0 HP, save against STR, and a
   * failure is a state the sheet carries rather than another number.
   */
  criticalDamage?: {
    /** Which attribute's save leaves it. */
    attributeId: string;
    /** The sheet field and statblock key it is recorded under. */
    key: string;
    label: string;
  };
  attributes: readonly {
    /** Stable id used by the API; the sheet and statblock keys may differ. */
    id: string;
    label: string;
    /** Character and hireling sheet keys. Both sheets use the same names. */
    currentKey: string;
    maximumKey: string;
    /** The NPC statblock field holding the same score, where there is one. */
    statblockKey?: string;
  }[];
}

/**
 * How much of a table roll the room sees. `public` shows the result to the GM
 * and tells players a roll happened, `private` does the same as an explicit
 * restricted choice, `invisible` tells players nothing, and `reveal` shows
 * everyone the text that was rolled.
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
  initiative: InitiativeRules;
  npcStatblock: NpcStatblockDefinition;
  /** Omit for a system where hit points are the only pool damage touches. */
  attributeDamage?: AttributeDamageDefinition;
  /** What a weapon that is not used in arm's reach is drawn as. */
  rangedWeaponIcon: RangedWeaponIcon;
  /**
   * Headings whose definition lists state what this system's weapon words mean.
   * Omit for a book that explains its words in prose alone; those are written
   * into `traits.json` by hand.
   */
  traitCatalog?: { headings: readonly string[] };
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
