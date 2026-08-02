# Encounters and the combat tracker

A plan for the Encounter tab, encounter records, NPC statblocks, and the initiative rail.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Initiative is **per-system**, declared in a new `initiative` block on `GameSystem`.                                                                                                                                                                                                                          |
| 2   | Players see an NPC's **name, position, armor, and drawn weapon** — what anyone in the room could see — and never its HP, statblock, notes, or conditions. Filtered on the server. (Armor and weapon were GM-only until they were asked for; the line is what is plain to look at, not what is written down.) |
| 3   | NPCs get **real statblocks with their own schema**, distinct from `characterSheet`. A **full per-system parser** turns a bestiary entry into one.                                                                                                                                                            |
| 4   | Several encounters may be active. The rail's combat tracker gets a **dropdown** to switch between them; the GM can always switch.                                                                                                                                                                            |
| 5   | The encounter image **references a Library asset** (`media.id`).                                                                                                                                                                                                                                             |
| 6   | When a combatant's source is deleted, the combatant is **removed automatically**.                                                                                                                                                                                                                            |
| 7   | The GM **can damage and heal any combatant**, including player characters, writing through to the character sheet. This is not an encounter rule: **GM read and write access to player character sheets is standard across the whole application** — see "GM access to player sheets" below.                 |

### Assumptions, flagged so you can overrule them

- **Activating an encounter does not move anyone's view.** The tab appears; players switch to it themselves. Auto-switching a player's central pane mid-session is intrusive, and nothing else in this app does it.
- **Players get the same rail dropdown**, listing active encounters only. The GM's lists every encounter, active or not.
- **No round counter and no current-turn marker.** The rail shows the order; whose turn it is stays in the GM's head, as it does today.

---

## What exists today

The executing model must work with these, not around them.

- **Central pane** is `client/src/TableMediaViewer.tsx`, a tab bar over `map | scene | reference | group | rules`. It already implements "click the active tab again → dropdown picker" (`activateTab` → `togglePicker`, `pickerOptions`, portal menu). The Encounter tab reuses that pattern verbatim for encounter selection.
- **Right rail** is `<aside className="context-panel">` in `client/src/App.tsx`, rendering only `<Chat>`. There is no tab structure there yet — it has to be built.
- **Mobile** has a separate `nav.mobile-tabs` with Scene / Chat / Sheet / Dice / Refs, and a `panel` state of `"scene" | "chat"`. Both need the new surfaces.
- **NPCs** are `custom_npcs (id, room_id, created_by, name, notes)` — free text. The built-in catalogue is Markdown parsed out of the rulebook by `npcCatalog()` in `server/src/npcs.ts`, driven by each system's `npcCatalog: { heading, entryLevel, exclude }`.
- **Hirelings** have no rows. They live inside `room_state.group_json`, an untyped blob (`parseGroupState` returns `Record<string, unknown>`), with images keyed by a string `hireling_id`.
- **`GroupPage` does not know who is looking.** Its props (`GroupPage.tsx:122-140`) carry `viewerId` but no `role` and no `isGm`, and `App.tsx` passes none. Every gap below follows from that one omission, and adding the prop is the shared first step.
- **Characters** are real rows with a `sheet` JSON blob and server-enforced ownership in `server/src/characters.ts`.
- **Realtime** is `broadcastRoom` / `sendToRoomGms` / `sendToRoomPlayers` in `server/src/realtime.ts`, using coarse events like `{ type: "npcs-updated" }` that make clients refetch.
- **Read-only sheets** already exist: `client/src/ReadOnlyCharacterSheet.tsx` takes a `ReadOnlyCharacter`. Requirement 9's "click to view their sheet" reuses it for characters and hirelings.
- **Dice** — `openDice(initialSave?: SaveRollSetup)` in `App.tsx` already opens the dice modal preloaded with a save. Cairn's DEX-save contest hooks straight into it.

---

## GM access to player character sheets

**The rule:** a room's GM can read and write any character in that room, exactly as its owner can. A player can read and write only their own, plus what the room already shows them. This holds on every surface, and a new surface inherits it rather than deciding for itself.

### It is already true — do not build it

This was mis-stated in an earlier draft of this plan. The authority exists today on both sides:

- **Server** — `findAccessibleCharacter` (`server/src/characters.ts:133`) refuses only when `context.role === "player"` and the caller is not the owner. A GM passes straight through. It already gates the sheet `PATCH`, portrait upload, portrait delete, and character delete, so a GM can already edit any sheet in their room.
- **Client** — `CharacterModal.tsx:199`: `const canEdit = selected && (role === "gm" || selected.ownerAccountId === accountId)`.

So the encounter tracker's HP write-through is **not a new permission**. It is an existing one reached from a new place, and it must call the existing route rather than introduce a second way to write a sheet.

### The gaps to close

What is inconsistent is not the authority but which surfaces expose it.

| Surface                                                | Today                                                                 | Should be                                                                            |
| ------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `CharacterModal`                                       | GM edits fully                                                        | correct already                                                                      |
| `GroupPage` party roster (`GroupPage.tsx:832`)         | `ReadOnlyCharacterSheet` for **everyone, GM included**                | GM gets an editable sheet, or a control that opens the character in `CharacterModal` |
| Encounter roster and combat tracker (new)              | —                                                                     | GM edits inline; players read their own                                              |
| Hireling and starship sheets (`room_state.group_json`) | **any room member can write the whole blob**, through the ordinary UI | GM-gated on the server, hidden on the client — see "Group state writes" below        |

The `GroupPage` one is the real gap: a GM looking at the party roster has to leave it and reopen the character elsewhere to change anything. Closing it is a small change — pass a `canEdit` through and either swap in the editable sheet or add an "Open sheet" affordance — but it belongs to this work because the encounter roster will render party members the same way and should not fork the behaviour.

### One shared helper

Both new surfaces and the `GroupPage` fix route through a single predicate rather than restating the role test:

```ts
/** Whether this viewer may write this character. The GM of the room always may. */
export function canEditCharacter(
  viewer: { accountId: number; role: RoomRole },
  character: { ownerAccountId: number | null }
): boolean;
```

Put it in `client/src/character-permissions.ts` beside the existing `member-permissions.ts` and `account-permissions.ts`, with the server keeping `findAccessibleCharacter` as the authority. The client helper decides what to _show_; it is never the thing that enforces.

## Group state writes

The same audit turned up the inverse problem, and it is in scope because it is the same missing prop and the same surface.

### What is open

`PATCH /rooms/:roomId/group` (`server/src/group.ts:151`) checks only `groupContext`, which returns successfully for **any** room role. Neither layer gates it:

- **Server** — no role test. A player can replace the whole `group_json`: every hireling, the starship sheet and its installed parts, all group fields.
- **Client** — `GroupPage` receives no `role` prop, so it renders the full editor to everyone. It is not hiding these controls, because it cannot.
- **Collateral** — the route prunes `hireling_images` for any id absent from the submitted payload, so a stale or trimmed write also deletes portraits from disk.

This is reachable through the ordinary interface, not just a crafted request. It is not a GM-access problem — it is the opposite — but it shares a cause with the gaps above, and the encounter work touches hirelings and would otherwise inherit the assumption that group writes are already gated.

### The fix

**`PATCH /group` is not the only open route.** The hireling and starship image routes — `POST` and `DELETE` on `…/group/hirelings/:id/image` and `…/group/starships/:id/image` (`group.ts:206` onwards) — resolve through the same `groupContext` and have the same missing check. Gating the `PATCH` alone leaves a player able to upload, replace, and delete group portraits. Every mutating route in `group.ts` needs the rule; the two `GET` image routes stay open to members.

**Server first, since that is where the rule lives.** Add a role check to each mutating group route, in the shape `npcs.ts` and `tables.ts` already use:

```ts
const roomId = Number(req.params.roomId);
if (roomRole(req.account!.id, roomId) !== "gm")
  return res.status(403).json({ error: "The group page is maintained by the room GM." });
```

**Then the client**, so a player is not shown controls that will now fail: pass `role` into `GroupPage` from `App.tsx` and render read-only for players — the same prop the `ReadOnlyCharacterSheet` gap needs, which is why the two land together.

**Decide the boundary before implementing.** All-or-nothing GM-only is the safe default and matches every sibling route, but check `GroupPage` for anything a player legitimately edits — shared notes, or their own hireling — before locking the whole page. If something qualifies, gate per field or per hireling rather than widening the whole route back open. Whatever is chosen, the server enforces it; `AGENTS.md` is explicit that role checks are a server responsibility regardless of what the client shows.

**Tests:** a player's `PATCH /group` is refused; a GM's succeeds; a refused write leaves `hireling_images` untouched — that last one is the collateral path and the easiest to regress. Add the same refusal test for each image upload and delete route, since those are separate handlers that will not inherit the fix.

---

## System definitions

### `initiative` on `GameSystem`

**All three systems are side-based.** An earlier draft of this plan had Cairn and Monolith as "no initiative", which was wrong — see the sources quoted below. What differs between them is how side order is decided, not whether sides exist.

```ts
export type InitiativeModel = "none" | "side" | "individual";

export interface InitiativeRules {
  model: InitiativeModel;
  /** Sides in their default order, which is also the fixed order when `sideOrder` is "fixed". */
  sides?: readonly { id: string; label: string }[];
  /** "fixed" keeps `sides` order every round; "roll" decides it each combat. */
  sideOrder?: "fixed" | "roll";
  /** How a side's value is rolled, when `sideOrder` is "roll". */
  roll?: { dice: string; modifierFrom?: "best-dex" | "dex"; label: string };
  /**
   * A save each party member makes at the start of combat. Cairn and Monolith both
   * have one, but they cost different things on a failure — see `onFailure`. It is
   * not a round-by-round roll.
   */
  entrySave?: {
    label: string;
    appliesTo: "party";
    /**
     * "after-opponents" — the character still acts, but their opponents go first (Cairn).
     * "skip-first-turn" — the character does not act in the first turn at all (Monolith).
     */
    onFailure: "after-opponents" | "skip-first-turn";
    description: string;
  };
  /** Who wins equal values. CWN gives ties to the PCs, in both side and individual order. */
  tieBreak?: "party-wins";
  /** Systems offering individual order as a variant, as CWN 2.4.2.1 does. */
  allowIndividualVariant?: boolean;
  note?: string;
}
```

Filled in from the actual rules — do not invent beyond these:

**Monolith** (`raw/Monolith.md:1347-1361`, the `# COMBAT RULES` chapter). The source is explicit: _"At the Start of Combat, each PC must make a DEX Save for a chance to act before their adversaries. If PCs fail their DEX Save, they don't act in the first turn. Subsequent rounds will always go PC Turn, then Enemy Turn."_

```ts
initiative: {
  model: "side",
  sides: [{ id: "party", label: "PC turn" }, { id: "enemies", label: "Enemy turn" }],
  sideOrder: "fixed"
}
```

**Monolith's opening save is not tracked.** It was planned as an `entrySave` with `onFailure: "skip-first-turn"`, and was built that way; in play the save is made and resolved at the table, so the rail's per-character marks recorded something nobody was reading. Monolith now ships with no `entrySave` and no `note` — Cairn keeps both, and `entrySave.onFailure` still carries the difference between the two games for anything that wants it.

**Cairn** (`raw/Cairn.md:754-756`) — **similar but not identical, and the difference matters.** The rule reads _"At the start of combat, each PC must make a DEX save to act before their opponents"_, and the worked example is _"She fails, and the Troll gets to attack first."_ The Troll going first is the whole cost: Bea still acts, just after it. Cairn never says a failed save forfeits the action, and Monolith's "they don't act in the first turn" is Monolith's own addition.

```ts
initiative: {
  model: "side",
  sides: [{ id: "party", label: "Party" }, { id: "enemies", label: "Opponents" }],
  sideOrder: "fixed",
  entrySave: {
    label: "DEX",
    appliesTo: "party",
    onFailure: "after-opponents",
    description: "A PC who passes acts before their opponents; one who fails acts after them."
  },
  note: "Cairn does not state how rounds after the first are ordered. The tracker keeps the order it has until the Warden changes it."
}
```

**Cairn's subsequent-round ordering is a decision, not a quotation.** The SRD says only that PCs declare each round before dice are rolled. Rather than importing Monolith's explicit PC-turn/enemy-turn rule into a game that never states it, the tracker holds the order from the opening saves and lets the Warden rearrange. The `note` says so in the rail, so nobody mistakes it for a rule.

**CWN** (`raw/CitiesWithoutNumberSRDv1.0.md:1244-1250`):

```ts
initiative: {
  model: "side",
  sides: [{ id: "party", label: "Party" }, { id: "enemies", label: "Enemies" }],
  sideOrder: "roll",
  roll: { dice: "1d8", modifierFrom: "best-dex", label: "Initiative" },
  tieBreak: "party-wins",
  allowIndividualVariant: true
}
```

`modifierFrom: "best-dex"` reads `dexModifier`, which `systems/cwn/src/index.ts:30` already declares on the character sheet. No new field is needed.

**`model: "none"` is unused by every shipped system.** Keep the variant for a future system that has no ordering, but Phase 5 has no "none" branch to build — do not write UI for a case nothing reaches.

### `npcStatblock` on `GameSystem`

Separate from `characterSheet`, because monster stats are not character stats.

```ts
export interface NpcStatblockField {
  key: string;
  label: string;
  kind: "number" | "text";
  /** Shown on the compact rail row rather than only in the expanded sheet. */
  inSummary?: boolean;
}

export interface NpcStatblockDefinition {
  /** Which field carries hit points, for damage tracking. */
  hitPointsKey: string;
  armorKey?: string;
  fields: readonly NpcStatblockField[];
}
```

- **Cairn / Monolith:** `hp`, `armor`, `str`, `dex`, `wil`, `attacks` (text). `hitPointsKey: "hp"`, `armorKey: "armor"`.
- **CWN:** `hd`, `hp`, `damageSoak`, `acRanged`, `acMelee`, `tt`, `skill`, `save`, `atk`, `dmg`, `shock`, `move`, `ml`, `gear`. `hitPointsKey: "hp"`, no armour key — CWN uses AC. `damageSoak` is the `+N` in `5 HP+2`; see the parser section.

---

## NPC statblock parsers

`server/src/npc-statblocks.ts`, one exported parser per format, chosen by system. Each takes a bestiary entry's Markdown and returns `{ fields: Record<string, string | number>, unparsed: string }` — the original Markdown always survives in `unparsed`, so a parser that misses something never loses it.

### Cairn and Monolith — one parser, two spellings

Cairn italicises the line, Monolith does not, and Monolith uppercases the die:

```
*4 HP, 8 STR, 14 DEX, 8 WIL, spear (d6)*          ← Cairn
*12 HP, 2 Armor, 14 STR, 1 DEX, 8 WIL, bite (d10)*  ← Cairn, with armour
3 HP, 8 STR, 12 DEX, 8 WIL, Shiv (D6)              ← Monolith
```

The first non-heading, non-bullet line of the entry, with optional `*…*`, split on commas. Each part is `<number> <LABEL>` for `HP`, `Armor`, `STR`, `DEX`, `WIL`; everything left over joins into `attacks`. Armour is absent more often than present — default it to 0, do not fail.

### CWN — its own parser

A two-column key/value block, followed by free-text tail lines:

```
HD:        1 (5 HP+2)        Atk:        +1r/+1m
AC:        13r/10m           Dmg:        Wpn
TT:        6+                Shock:      None
Skill:     +2                Move:       15m
Save:      14+               ML:         9
Bite (1d6+1 dmg, Trauma 1d6/x2)
```

**The alignment is non-breaking spaces, not spaces or tabs.** `cat -A` on `raw/CitiesWithoutNumberSRDv1.0.md:4327` shows `HD:M-BM- M-BM- …` — U+00A0, 742 of them in the file. Splitting on `\s` in JavaScript does match U+00A0, but splitting on a literal `[ \t]{2,}` does not, and that is the obvious way to write it. **Normalise U+00A0 to a space before splitting**, and add a fixture line containing a real non-breaking space so a future "tidy up the regex" cannot silently break every entry.

Pair each `Label:` with the value that follows and accept pairs in any column position; the layout is cosmetic and inconsistent across entries.

**`HD` carries three values, not two.** The forms are `2 (10 HP)` and `1 (5 HP+2)`, where the `+N` suffix is Damage Soak from armour, described at line 4208 as bonus hit points. Parse all three:

- `hd` — the hit dice (`1`)
- `hp` — base hit points (`5`), numeric, the value the tracker decrements
- `damageSoak` — the suffix (`2`), default `0`

Dropping the suffix silently understates a third of the bestiary's durability, so `damageSoak` joins the CWN field list. Whether the tracker adds it to the HP pool or shows it beside is a display decision; the parser's job is not to lose it.

`AC` carries ranged and melee as `13r/10m`; `Atk` likewise as `+1r/+1m`. Values keep their notation (`6+`, `None`, `Wpn`) as text — only `hp` and `damageSoak` need to be numeric.

**Tail lines are gear and attacks.** Everything after the key/value block that is not a bullet — weapon lines like `Bite (1d6+1 dmg, Trauma 1d6/x2)`, armour, and Edges — joins into the `gear` field in source order, newline-separated. Do not try to structure them; the shapes vary too much, and the full Markdown survives in `unparsed` regardless.

### Verifying the parsers

The same problem the table migration had: a parser that quietly gets it wrong looks exactly like one that works.

- A test parses **every** entry `npcCatalog()` returns for all three systems and asserts none throws and every one yields a numeric `hp`.
- A checked-in fixture pins the parsed output of five hand-checked entries per system.
- Any entry whose `hp` cannot be read is reported in the clone UI as "stats could not be read — fill them in", never silently zeroed.

---

## Data model

New tables in the `CREATE TABLE IF NOT EXISTS` block of `server/src/db.ts` — new tables need no migration, only altered ones do.

```sql
CREATE TABLE IF NOT EXISTS encounters (
  id INTEGER PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  individual_initiative INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES accounts(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS encounter_sides (
  encounter_id INTEGER NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
  side TEXT NOT NULL,
  initiative INTEGER,
  PRIMARY KEY (encounter_id, side)
);

CREATE TABLE IF NOT EXISTS encounter_combatants (
  id INTEGER PRIMARY KEY,
  encounter_id INTEGER NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('character', 'hireling', 'npc')),
  character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
  npc_id INTEGER REFERENCES custom_npcs(id) ON DELETE CASCADE,
  hireling_id TEXT,
  name TEXT NOT NULL,
  side TEXT NOT NULL DEFAULT 'enemies',
  /** Only used when the encounter is running individual initiative. */
  initiative INTEGER,
  /** Cairn and Monolith: start-of-combat save result. NULL = not rolled, 1 = passed, 0 = failed. */
  acts_first_turn INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  /** NPCs only. Characters and hirelings carry HP on their own sheet — see below. */
  hp_current INTEGER,
  hp_max INTEGER,
  statblock_json TEXT NOT NULL DEFAULT '{}',
  conditions TEXT NOT NULL DEFAULT '',
  included INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Exactly one source, and it must match `kind`.
  CHECK (
    (kind = 'character' AND character_id IS NOT NULL AND npc_id IS NULL AND hireling_id IS NULL) OR
    (kind = 'npc'       AND npc_id IS NOT NULL AND character_id IS NULL AND hireling_id IS NULL) OR
    (kind = 'hireling'  AND hireling_id IS NOT NULL AND character_id IS NULL AND npc_id IS NULL)
  )
);

-- One row per character and per hireling in an encounter. NPCs are deliberately
-- exempt: three goblins from one record is the point.
CREATE UNIQUE INDEX IF NOT EXISTS encounter_combatants_character
  ON encounter_combatants (encounter_id, character_id) WHERE character_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS encounter_combatants_hireling
  ON encounter_combatants (encounter_id, hireling_id) WHERE hireling_id IS NOT NULL;
```

Plus one guarded column, since `custom_npcs` already exists in the field:

```ts
if (!hasColumn("custom_npcs", "statblock_json"))
  db.exec("ALTER TABLE custom_npcs ADD COLUMN statblock_json TEXT NOT NULL DEFAULT '{}'");
```

Notes on the shape:

- **`ON DELETE CASCADE` on `character_id` and `npc_id` implements decision 6 for free** at the database level. It does _not_ produce a realtime event, though — see "Cascades are silent" under Server.
- **`included`** is requirement 7's toggle. The encounter's settings list every party character and hireling with a checkbox; unchecking sets `included = 0` rather than deleting the row, so HP and initiative survive a toggle off and back on.
- **`statblock_json` on the combatant is a snapshot** taken when the NPC is added. Three goblins from one record get three independent statblocks, and editing the encounter's goblin never edits the template.
- **`media_id` is `ON DELETE SET NULL`**, so deleting a Library image leaves the encounter intact without its picture.
- **The CHECK constraint and the two partial indexes are not decoration.** Without them the schema accepts a combatant with no source, one with three, or the same character added twice. SQLite enforces both cheaply; application-level validation alone will drift.

### Opening saves are cleared by hand

`acts_first_turn` marks the first turn only, and there is no round counter to tell the tracker when the first turn ends. Without something to end it, a failed save annotates a row forever.

**The GM clears it explicitly.** The rail carries one **Clear opening saves** control that sets `acts_first_turn` back to `NULL` for every combatant in the encounter, and the annotation is worded as a reminder rather than a state — "acts after opponents" for Cairn, "sits out first turn" for Monolith. Rolling the saves again also clears the previous results first.

This is deliberately not a turn cursor. It is one button that resets one column, matching the decision that the tracker orders combatants and does not run the round. `POST …/encounters/:id/opening-saves` sets them; `DELETE` on the same path clears them.

### Hit points have exactly one home

**NPC HP lives on the combatant** (`hp_current`, `hp_max`) — there is nowhere else for it, since `custom_npcs` is a template that may be instantiated many times.

**Character and hireling HP is read from the sheet at request time and never copied.** A character's HP is in `characters.sheet_json`; a hireling's is in `room_state.group_json`. Snapshotting either into the combatant row creates two values that disagree the moment a player edits their own sheet — which happens constantly, through a route that knows nothing about encounters. The combatant row stores `character_id`, and the server joins the sheet when building the payload, reading the HP keys from the system's `characterSheet` definition (`hpCurrent` / `hpMax` for Cairn and Monolith).

This is also what makes requirement 7 coherent: the GM's damage write goes to the sheet, the tracker re-reads the sheet, and there is no second number to reconcile.

`hp_current` and `hp_max` are therefore `NULL` for every character and hireling combatant. A test should assert that.

### Sides are seeded and validated from the system

`encounter_sides` is populated from `initiative.sides` when the encounter is created — one row per declared side, `initiative` left `NULL`. Nothing invents a side at runtime.

Three validations follow, all server-side:

- a combatant's `side` must be one of the system's declared side ids; reject anything else rather than storing a side the rail cannot group
- `individual_initiative` may only be set to `1` when the system declares `allowIndividualVariant` — Cairn and Monolith do not, and neither has an individual mode to fall back to
- setting a side's `initiative` requires `sideOrder === "roll"`; a fixed-order system has no value to store

Without these, a client can put a combatant on a side that does not exist and it will simply vanish from a grouped rail.

### Every query scopes by room

An encounter id and a combatant id both arrive from the client. Nested routes must scope through `room_id` on every query, not just the outermost one:

```sql
SELECT c.* FROM encounter_combatants c
  JOIN encounters e ON e.id = c.encounter_id
 WHERE c.id = ? AND e.id = ? AND e.room_id = ?
```

The same applies when adding a combatant: verify the character, hireling, or NPC belongs to **this** room and system before inserting. Nothing in the schema prevents a combatant pointing at another room's character, and a foreign key will happily accept it.

---

## Server

New `server/src/encounters.ts`, mounted in both `index.ts` and — no. **Game server only.** The Devil's Tables has no rooms.

| Route                                                  | Role   | Notes                                                                      |
| ------------------------------------------------------ | ------ | -------------------------------------------------------------------------- |
| `GET /rooms/:roomId/encounters`                        | member | GM: all. Player: active only, filtered.                                    |
| `POST /rooms/:roomId/encounters`                       | GM     |                                                                            |
| `PATCH /rooms/:roomId/encounters/:id`                  | GM     | name, notes, `media_id`, `individual_initiative`                           |
| `POST /rooms/:roomId/encounters/:id/activate`          | GM     | body `{ confirmed: boolean }` — see below                                  |
| `POST /rooms/:roomId/encounters/:id/deactivate`        | GM     |                                                                            |
| `DELETE /rooms/:roomId/encounters/:id`                 | GM     |                                                                            |
| `PUT /rooms/:roomId/encounters/:id/roster`             | GM     | the include/exclude toggles from requirement 7                             |
| `POST /rooms/:roomId/encounters/:id/combatants`        | GM     | add an NPC instance, character, or hireling                                |
| `PATCH /rooms/:roomId/encounters/:id/combatants/:cid`  | GM     | hp, initiative, side, conditions, name, order                              |
| `DELETE /rooms/:roomId/encounters/:id/combatants/:cid` | GM     |                                                                            |
| `POST /rooms/:roomId/encounters/:id/roll-initiative`   | GM     | uses the system's `initiative.roll`; 404s when the system has none         |
| `POST /rooms/:roomId/npcs/:npcId/clone`                | GM     | requirement 8                                                              |
| `POST /rooms/:roomId/npcs/from-catalog`                | GM     | clone a **built-in** bestiary entry into `custom_npcs`, running the parser |

### Requirement 5's confirmation

`activate` returns `409 { error, activeEncounters: [{ id, name }] }` when at least one other encounter is already active and `confirmed` is not `true`. The client shows the confirm dialog and retries with `confirmed: true`. **The check belongs on the server** — a client-side-only confirm is not a rule, it is a suggestion.

### Requirement 2's filtering

One function, and every player-facing path goes through it:

```ts
/** What this viewer may see. An NPC's stats never leave the server for a player. */
export function visibleEncounter(encounter: Encounter, viewer: { accountId: number; role: RoomRole }): PublicEncounter;
```

**It takes an account id, not just a role.** "Characters are the party's own, send them in full" is wrong: `findVisibleCharacter` (`characters.ts:107`) already restricts a player to their own characters, unowned pool characters for that room, and characters _currently active_ in the room. A GM can add any character they can reach to an encounter — including another player's inactive, private one — and sending it in full would leak a sheet the encounter has no business widening access to.

So for `role === "player"`:

- **character combatants** — run each through the existing `findVisibleCharacter` rule. Visible ones are sent with their sheet; the rest degrade to name and position, exactly like an NPC.
- **npc combatants** — keep `id`, `name`, `side`, `sortOrder`, position. Drop `statblock`, `hpCurrent`, `hpMax`, `conditions`, `notes`.
- **hireling combatants** — sent in full; they are shared group state that every member can already read.

Reuse the rule rather than restating it. If `findVisibleCharacter` changes, the encounter filter must change with it, which is an argument for exporting it (see the write-path extraction below) rather than copying its three conditions.

Never filter in the client; `AGENTS.md` is explicit that a client must not be trusted to withhold what it was sent.

### Cascades are silent

`ON DELETE CASCADE` removes combatant rows without telling anyone. Deleting a character broadcasts `characters-updated`; deleting an NPC broadcasts `npcs-updated`. Neither makes a client refetch encounters, so a deleted combatant sits in the tracker until something unrelated happens.

Two ways to fix it; take the second:

1. Emit `encounters-updated` from the character and NPC delete routes — couples those routes to a feature they know nothing about.
2. **Have the client refetch encounters on `characters-updated`, `npcs-updated`, `group-updated`, and `media-updated` as well as `encounters-updated`.** The events already exist and already fire; the encounter view listens to all five. No server route changes, and it also covers hireling removal.

`media-updated` belongs in that list for two reasons: deleting a Library asset sets `media_id` to `NULL` through `ON DELETE SET NULL` without any encounter event, and revealing or hiding an asset changes whether players can render it at all.

### Encounter images and player access

`media.visible` defaults to `0`, and the file endpoint (`media.ts:369`) allows a player through only when `role === "gm" || kind === "audio" || visible`. So an encounter pointing at a freshly uploaded Library asset shows the GM a picture and shows players a broken image.

- **Activating an encounter does not silently reveal its image.** Reuse the Library's existing reveal — the encounter editor shows "This image is hidden from players" beside the picker, with a control that sets `visible = 1` through the existing media route. The GM stays in charge of what the table sees, consistent with how every other asset works.
- **Omit a hidden image from the player payload entirely.** Sending a `mediaUrl` a player cannot fetch produces a broken image and tells them an image exists. `visibleEncounter` drops the field for players when `visible` is 0, and the panel falls back to its no-image layout — which requirement 6 already specifies.
- **Validate the asset on assignment by MIME, not by kind.** It must belong to this room and be an image. Rejecting every `reference` asset would be wrong — references are frequently images, and decision 5 says "a Library asset". Reject audio, and reject Markdown using the existing test in `client/src/MediaContent.tsx:6`: `mimeType === "text/markdown"` or a `.md` filename. A Markdown reference rendered as an encounter image would be a content leak with none of the Library's reveal semantics.

### Encounter notes are GM-only

`encounters.notes` is unstated in requirement 6 and the player panel currently renders whatever it receives. Treat it as **GM notes and strip it for players**, matching `custom_npcs.notes`, which players never see. A GM who wants the table to read something puts it in the encounter _name_, or reveals a Markdown reference through the Library, which already has reveal semantics.

If a public description is wanted later, add a second field rather than reclassifying this one — silently widening an existing notes field is how GM prep leaks.

Because a name is all a player sees, the combatant's `name` is independently editable — a GM can list "Hooded Figure" while the record stays "Cult Assassin".

### Requirement 7's HP write-through needs a refactor first

`PATCH …/combatants/:cid` with a new `hpCurrent`, where `kind === "character"`, must go through the existing character update path. **But that path is not callable today.** In `server/src/characters.ts`, `roomContext`, `publicCharacter`, `findVisibleCharacter`, `findAccessibleCharacter`, and `broadcastCharacterChange` are all module-private, and the `UPDATE characters` itself is written inline in the route handler. "Call the existing path" is not currently possible — an encounter route would end up duplicating the sheet merge, the warnings, the response shape, and the broadcast.

**Extract before reusing.** A small, mechanical refactor in Phase 0, no behaviour change:

```ts
// server/src/characters.ts
export function findVisibleCharacter(accountId: number, roomId: number, characterId: number): …
export function findAccessibleCharacter(accountId: number, roomId: number, characterId: number): …
export function publicCharacter(row: CharacterRow, roomId: number): …

/** The one place a character sheet is written. Both the PATCH route and the encounter tracker call this. */
export function updateCharacter(
  accountId: number,
  roomId: number,
  characterId: number,
  changes: {
    name?: string;
    /** Replaces the whole sheet. The PATCH route sends this; the tracker must not. */
    sheet?: Record<string, unknown>;
    /** Merges over the stored sheet. Use this for a change to a few keys. */
    sheetPatch?: Record<string, unknown>;
  }
): { character: PublicCharacter } | { error: string; status: number };
```

**`sheetPatch` is not optional politeness — without it the tracker will erase character sheets.** The existing route writes `sheet_json = COALESCE(?, sheet_json)` with a complete serialised sheet, so it _replaces_. An implementation told to "call it with a sheet carrying the new HP" will reasonably pass `{ hpCurrent: 3 }` and wipe every other field on the character. `updateCharacter` reads the stored sheet, merges `sheetPatch` over it, and writes the result; the tracker only ever sends `sheetPatch`.

**All three systems use `hpCurrent` and `hpMax`** — Cairn, Monolith (labelled "Hit Protection"), and CWN (`systems/cwn/src/index.ts:47`). Read the keys from the system's `characterSheet` definition rather than hard-coding them, but there is no per-system divergence to design around today.

The existing `PATCH /rooms/:roomId/characters/:characterId` becomes a thin caller of `updateCharacter`, which keeps `findAccessibleCharacter`, the `UPDATE`, `characterWarnings`, and `broadcastCharacterChange` in one place.

Exporting `findVisibleCharacter` is what lets `visibleEncounter` reuse the visibility rule instead of copying it.

**Tests:** a GM's HP change through the tracker and the same change through `PATCH /characters/:id` leave the database in an identical state, and both broadcast; and a `sheetPatch` touching one key leaves every other key on the sheet intact.

### Hireling HP write-through

Hireling HP is authoritative in `room_state.group_json`, which means the tracker needs a second write path — `updateCharacter` cannot reach it. Phase 0's group work must also produce:

```ts
/** Merges changes into one hireling inside the group blob. The only way hireling HP is written. */
export function updateHireling(
  roomId: number,
  hirelingId: string,
  changes: Record<string, unknown>
): { state: Record<string, unknown> } | { error: string; status: number };
```

- Read `group_json`, find the hireling by `id`, merge, write back — **in one transaction**, because the group page autosaves the whole blob and a read-modify-write race would drop a concurrent edit.
- HP keys come from `groupPage.hirelings.sheet`, which is a `CharacterSheetDefinition` like any other; Cairn and Monolith both use `hpCurrent`/`hpMax` there too.
- Broadcast `group-updated` on success, so an open group page refreshes.
- The route is GM-only, consistent with everything else in `group.ts` after Phase 0.

A hireling combatant's HP edit in the rail calls this. Nothing else writes hireling HP.

### Realtime

One coarse event, matching how `npcs-updated` already works:

```ts
broadcastRoom(roomId, { type: "encounters-updated" });
```

Clients refetch and re-filter. Player and GM payloads differ, so a single broadcast with the data inlined would leak — **broadcast the signal, not the encounter.**

---

## Client

### Central pane — the Encounter tab

In `TableMediaViewer.tsx`: add `"encounter"` to `MediaTab`, add the tab button (guarded by `encounters.length > 0 || isGm`), and add `"encounter"` to `pickerOptions` / `selectedPickerId` / `tabLabel` / `choosePicker` so the existing dropdown lists encounters. This is the same wiring the `group` tab already has — follow it line for line.

Panel content, per requirement 6:

- **With an image:** the Library asset fills most of the pane, encounter name and notes below it, roster condensed to a strip.
- **Without an image:** the roster and notes take the whole pane — combatants as cards with portraits where they have them (characters and hirelings already have image endpoints).

### Right rail — the combat tracker

`client/src/App.tsx` currently renders `<Chat>` alone inside `aside.context-panel`. Turn it into a two-tab rail:

- Tab bar appears **only** when at least one encounter is active; otherwise the rail is Chat exactly as today.
- Second tab holds `<CombatTracker>` with the decision-4 dropdown across encounters (GM: all; player: active only).
- `nav.mobile-tabs` gains a Combat entry under the same condition, and `panel` widens from `"scene" | "chat"` to include `"combat"`.

`client/src/CombatTracker.tsx` renders by `initiative.model`:

| Configuration                                          | Systems                                              | Rail contents                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `model: "side"`, `sideOrder: "fixed"`, `entrySave` set | Cairn (Monolith is the same without the save column) | Two fixed groups in `sides` order. Each party member gets a **DEX save** button calling the existing `openDice({ kind: "save", label: "DEX" })`; the outcome is recorded on `acts_first_turn` and annotates the row per `entrySave.onFailure`. No initiative numbers anywhere. |
| `model: "side"`, `sideOrder: "roll"`                   | CWN                                                  | Combatants grouped by side, one initiative value **per side** from `encounter_sides`, a **Roll initiative** button applying `1d8 + best DEX modifier` to each side. Ties go to the party. Honours `individual_initiative` to switch to the row below.                          |
| `individual_initiative = 1`                            | CWN only                                             | One ordered list, a value per combatant, roll-all and per-row re-roll. Ties go to the party.                                                                                                                                                                                   |

There is no `model: "none"` row, because no shipped system uses it.

Clicking a row opens the sheet:

- **Characters** — `ReadOnlyCharacterSheet` directly; the payload already matches `ReadOnlyCharacter`.
- **Hirelings** — **not plug-compatible.** `ReadOnlyCharacter` (`ReadOnlyCharacterSheet.tsx:6`) wants a numeric `id`, a nested `sheet`, `ownerAccountId`, `ownerUsername`, `warnings`, and `activeBy`; a hireling has a string id, flat fields, and no owner or active state. Write a small adapter that maps a hireling onto that shape — synthetic negative id, fields lifted into `sheet`, `ownerAccountId: null`, empty `warnings` and `activeBy` — and render it against the system's `hirelings.sheet` definition rather than `characterSheet`. Do not widen `ReadOnlyCharacter` to make hirelings fit; that pushes the mismatch into every existing caller.
- **NPCs** — a new `NpcStatblockView` driven by `npcStatblock.fields`.

Players clicking an NPC row get nothing to open — the server sent them no statblock, and the row should not pretend otherwise. The same applies to a character combatant the viewer cannot see: it renders as a name and a position, with no affordance to open.

### NPC modal — requirement 8

`NpcModal.tsx` gains a **Clone** button on every entry:

- on a built-in bestiary entry → `POST /npcs/from-catalog`, which runs the parser and creates a `custom_npcs` row with `statblock_json` filled and the original Markdown in `notes`
- on a custom NPC → `POST /npcs/:id/clone`, a straight copy named "… (copy)"
- the detail pane gains a statblock editor driven by `npcStatblock.fields`, above the existing notes textarea
- an **Add to encounter** control listing the room's encounters

**The existing NPC routes must learn about `statblock_json`.** `GET /rooms/:roomId/npcs` currently selects `id, name, notes, updated_at`, and `POST`/`PATCH` validate `{ name, notes }` only (`server/src/npcs.ts:53-87`). All three need the statblock: the `GET` selects and returns it, and the `POST`/`PATCH` zod schemas accept it, validated against the system's `npcStatblock.fields` so an unknown key is refused rather than stored.

**A built-in entry has no `custom_npcs.id`, so "Add to encounter" cannot reference it.** Make it one atomic route rather than two client calls: `POST /rooms/:roomId/encounters/:id/combatants` accepts either `{ kind: "npc", npcId }` or `{ kind: "npc", catalogName }`. Given a `catalogName` it clones the entry into `custom_npcs` and adds the combatant in one transaction. Two separate calls would leave an orphan `custom_npcs` row whenever the second fails, and would make the button's behaviour differ between built-in and custom entries for no reason the GM can see.

---

## Traps

Things a straightforward implementation gets wrong.

1. **Hireling removal cannot be inferred from the blob.** An earlier draft said to diff hireling id sets on every group write, "only when the payload contains a hirelings array". That does not work: a stale full-state save from a second tab carries an _older_ hirelings array, which is indistinguishable from an intentional removal. Diffing deletes combatants that were never removed.

   **Add an explicit `DELETE /rooms/:roomId/group/hirelings/:hirelingId`** that removes the hireling from the blob, deletes its image, and removes its combatants, in one transaction. This is the same shape as the NPC delete route, and after Phase 0 the group page is GM-only, so there is exactly one writer to migrate.

   Three things have to change together, or the route is decorative:

   - **`GroupPage.removeHireling` (`GroupPage.tsx:392`) must call the new route.** Today it filters the array locally and lets the autosave PATCH a shorter one — exactly the pattern being retired.
   - **`PATCH /group` must reject a payload that drops an existing hireling id**, answering with a 409 pointing at the DELETE route. Otherwise a stale tab or a crafted request still removes hirelings by omission, and the combatants it should have removed become orphans.
   - **`PATCH /group` should carry an `updatedAt` precondition**, refusing a write built from a stale read. The route already returns `updatedAt`; this stops a stale tab resurrecting a hireling that was explicitly deleted.

   Cover it with a test that saves the group twice from a stale copy and asserts no combatant disappears, and one that a PATCH omitting a live hireling is refused.

2. **Deleting an NPC record nukes it from live combat.** That is decision 6 working as specified, but it is a surprise mid-session. The NPC delete confirm must say how many active encounters it will affect.
3. **Player payloads must be filtered server-side**, including on the WebSocket-triggered refetch. The easiest mistake is a GM-shaped payload with the client hiding columns.
4. **Every shipped system is side-based, but Cairn and Monolith are not interchangeable.** Both open with a DEX save; failing it costs a Cairn character their _place in the order_ and costs a Monolith character _the turn itself_. That is `entrySave.onFailure`, and collapsing the two into one behaviour misreports one of the games. `model: "none"` exists in the type and is used by nothing.
5. **Encounter images are `media` rows.** Do not add a fourth image table; do not add byte accounting. `media.ts` already covers the capacity maths. Do check `visible` before assuming a player can load one.
6. **Requirement 4's tab visibility is a server fact.** A player's `GET /encounters` returning an empty array is what hides the tab — not a client-side `role === "gm"` check.
7. **Do not build GM sheet access — it exists.** `findAccessibleCharacter` already lets a GM write any character in their room. Adding a role check in the encounter routes would be a second, divergent copy of a rule that is already enforced one layer down.
8. **No round counter, no turn cursor.** If one appears in an implementation, it was not asked for. The tracker orders combatants; it does not run the round.

---

## Phases

Each phase ends green on `npm run typecheck && npm test && npm run build && npm run smoke`.

**Phase 0 — settle who may edit what.** Lands first and alone. Both later phases render party members and touch hirelings, and neither should fork these rules. Every item below turns on the same missing `role` prop, which is why they are one phase and not three.

1. Pass `role` into `GroupPage` from `App.tsx`, alongside the `viewerId` it already receives.
2. Add `canEditCharacter` to `client/src/character-permissions.ts`; adopt it in `CharacterModal` in place of the inline test at line 199.
3. Close the `GroupPage.tsx:832` gap so a GM can edit — or jump to — a party member's sheet from the party roster instead of leaving for the character modal.
4. Gate every mutating route in `group.ts` — the state `PATCH` and the four hireling/starship image routes — then render `GroupPage` read-only for players to match.
5. Extract the character write path: export `findVisibleCharacter`, `findAccessibleCharacter`, and `publicCharacter`, and lift the inline `UPDATE` into `updateCharacter(...)` **with `sheetPatch` support**. Pure refactor otherwise, but Phase 3 and Phase 5 both depend on it.
6. Add `updateHireling(...)` as the single transactional write path for one hireling inside `group_json`.
7. Add `DELETE /rooms/:roomId/group/hirelings/:hirelingId`; point `GroupPage.removeHireling` (line 392) at it; make `PATCH /group` refuse a payload that drops a live hireling id and honour an `updatedAt` precondition. Phase 3 depends on this too.

Item 4 is the only one that removes an ability anyone has today, so it is the one to confirm before merging. The rest are additive or internal.

Tests: the helper's truth table (GM / owner / other × owned / pool / unowned); a GM's sheet `PATCH` on a character they do not own succeeds while a non-owner player's is refused; a player's `PATCH /group` and each image route are refused while a GM's succeed; a refused group write leaves `hireling_images` intact; `PATCH /characters/:id` behaves identically before and after the extraction; a `sheetPatch` touching one key leaves the rest of the sheet intact; a `PATCH /group` omitting a live hireling is refused.

**Phase 1 — data and system definitions.** Schema, `custom_npcs.statblock_json` migration, `InitiativeRules` and `NpcStatblockDefinition` in `shared/src/index.ts`, the blocks filled in for all three systems. No routes, no UI. Tests: schema shape, migration idempotency, migration fails when removed, every system's blocks typecheck and are non-empty.

**Phase 2 — NPC statblocks.** The two parsers, the catalogue clone route, the custom clone route, `statblock_json` through the existing NPC `GET`/`POST`/`PATCH`, and the statblock editor in `NpcModal`. Tests: every catalogue entry across three systems parses with a numeric `hp`; five pinned fixtures per system; a fixture line containing a real U+00A0; a CWN `5 HP+2` entry yields `hp: 5, damageSoak: 2`; an unknown statblock key is refused by the `PATCH` schema.

**Phase 3 — encounters, server side.** All routes, `visibleEncounter` (taking an account id and reusing `findVisibleCharacter`), the activate-confirmation 409, side seeding and validation, room scoping on every nested query, encounter-image validation, the opening-saves set/clear routes, the `encounters-updated` broadcast. Tests: role filtering strips NPC stats and encounter notes for players **and** hides a character the viewer could not otherwise see; a hidden image is omitted rather than sent; activation confirmation; cascade removal; the CHECK constraint and both partial indexes reject malformed and duplicate combatants; a combatant cannot be added from another room; an unknown side and `individual_initiative` on Cairn are both refused; character and hireling combatants store no HP.

**Phase 4 — Encounter tab.** `TableMediaViewer` tab and picker, the panel in both image and no-image layouts, encounter CRUD UI, the roster toggles.

**Phase 5 — combat tracker rail.** The rail tab structure, `CombatTracker` for the two side variants (`sideOrder: "fixed"` with an entry save, and `sideOrder: "roll"`) plus CWN's individual variant, the opening-save buttons and the **Clear opening saves** control, the encounter dropdown, sheet and statblock views with the hireling adapter, GM HP write-through via `updateCharacter` (`sheetPatch`) and `updateHireling`, refetch on all five realtime events, mobile nav. No `model: "none"` branch — nothing reaches it.

Then: `changelog.md`, and an **Encounters** section in `AGENTS.md` covering the per-system initiative block, the server-side visibility rule, and the hireling reconciliation trap.

`AGENTS.md` also gains the sheet-access rule under **Engineering constraints**, beside the existing "Treat role checks as server responsibilities":

```markdown
- A room's GM reads and writes every character in that room, exactly as its owner does; a player reads and
  writes only their own. `findAccessibleCharacter` is the authority and already encodes this — a new surface
  calls it rather than restating the role test, and `canEditCharacter` decides only what the client shows.
  Two surfaces that write a sheet must leave the database in the same state.
- Shared room state — the group page, its hirelings, and its starships — is written by the GM. A route that
  takes a room id and writes something the whole table sees checks the role itself; `groupContext` and its
  like resolve a room, they do not authorise a write. A component that cannot be told the viewer's role
  cannot hide anything, so pass the role in rather than inferring it from what the data looks like.
```

## Open items

Both earlier open items are now closed: `raw/Monolith.md:1347` has a `# COMBAT RULES` chapter and Monolith is side-based, and `systems/cwn/src/index.ts:30` already declares `dexModifier`.

- **Does CWN's `damageSoak` add to the HP pool or sit beside it?** The source calls it bonus hit points, which argues for adding; it also regenerates differently from HP, which argues for showing it separately. The parser keeps the number either way — this is a display decision for Phase 5.
- **Cairn's subsequent-round order is decided, not quoted.** The tracker holds the order from the opening saves until the Warden changes it, and says so in the rail. Revisit if Cairn ever states a rule.
