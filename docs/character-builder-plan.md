# The character builder

A plan for a guided character creation wizard: the book's own creation chapter,
walked one step at a time, rolled on the server, landing on the ordinary
character sheet.

The builder is **the system's declaration and the application's engine**. A
system says what its steps are, in the same declarative `system.json` that
already says what its sheet looks like and what its warnings are; the
application knows how to perform a bounded list of step kinds and refuses one it
has never heard of. Nothing in a system is executed, here as everywhere else.

The reason this cannot be one hard-coded wizard is three books away. Monolith
rolls 3d6 in order and lets you swap two; Cairn rolls a name, a background, and
ten traits off two multi-column tables; Cities Without Number offers a rolled
array _or_ a point-assigned one, then spends skill points, then picks foci. A
wizard written for Monolith would be a wizard nothing else can use, and a wizard
general enough for all three is a small language. This plan is about keeping
that language small.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **`characterCreation` is optional and a system without one loses nothing.** Today's New character button stays exactly as it is: a blank sheet with a placeholder name. The builder is a second door onto the same room, never the only one.                                                                                                                                                                       |
| 2   | **A step kind is the application's word, not the system's.** `SYSTEM_CREATION_STEPS` is the list of things this build knows how to do, beside `SYSTEM_RULE_FEATURES`. A step naming a kind this build has not got is refused **at install**, not ignored — a wizard whose third step silently never appears is worse.                                                                                              |
| 3   | **A step writes sheet keys and nothing else.** Every key a step names must exist in `characterSheet`; every list it stows into must be one the sheet declares. Checked at install, the same way `warningRules` keys are, and for the same reason.                                                                                                                                                                  |
| 4   | **A character built by the wizard is indistinguishable from one built by hand.** No parallel store, no provenance on a field, no "wizard-owned" values. When the last step finishes, the creation state is dropped and what remains is a sheet.                                                                                                                                                                    |
| 5   | **The server rolls.** Every die goes through `rollDice` (`server/src/dice.ts:35`) and every table through the same parse the roller uses. `POST /group/hirelings/roll` (`server/src/group.ts:217`) already does this and is the precedent to widen, not to duplicate.                                                                                                                                              |
| 6   | **The draft lives on the server, so a half-built character survives a dead phone.** A nullable `characters.creation_json` records which steps have run and what they produced. Abandoning a build is deleting the character, which already works.                                                                                                                                                                  |
| 7   | **The ledger makes a reroll visible; it does not prevent one.** Rerolling is refused by no rule here. Tables house-rule this constantly, and the standing constraint is to warn rather than to bar. What the ledger buys is that the wizard knows what it has already done, which is what makes resuming possible.                                                                                                 |
| 8   | **Every step can be skipped, and the wizard can be left at any point.** A skipped step writes nothing. The sheet's own warnings — `evaluateCharacterWarnings` (`shared/src/character-warnings.ts:127`) — are what say a character is unfinished, exactly as they do for a hand-written one.                                                                                                                        |
| 9   | **Options come out of the book, not out of a restatement of it.** Monolith's twelve backgrounds are twelve headings under `BACKGROUNDS`, each owning its prose and its three tables. The declaration names the heading; the application enumerates. This is what `npcCatalog.heading` and `traitCatalog.headings` already do.                                                                                      |
| 10  | **Gear the book writes in prose is offered, not applied.** A background's `STARTING GEAR` bullets are shown as a checklist, matched against the room's item catalogue where the names match, and stowed when the player presses. A slot holds a plain string either way; the parse is presented rather than imposed.                                                                                               |
| 11  | **Derived values come from a closed vocabulary, never an expression.** `copy`, `constant`, `sum`, `difference`, `lookup`, each reading one or more keys and a `pick` of `highest`, `lowest`, or `total`. Cities Without Number's "Physical save is 15 minus the better of STR or CON" is a `difference` from 15 over the `highest` of two. Composition is what an expression is, so the operations do not compose. |
| 12  | **A creation roll does not go to chat.** Creation happens before play and would fill a room's log with somebody else's dice. The finished character announcing itself is a separate question, deliberately left alone.                                                                                                                                                                                             |

### Assumptions, flagged so you can overrule them

- **Character-scoped in v1.** Monolith's shared debt is a group step — one d12 for the whole company, rolled once, landing on group obligations. v1 points at Room Config for it rather than growing a `scope: "group"` step. See the open questions.
- **The player builds their own.** A GM building an unassigned pool character reuses the same wizard through the existing `unassigned` path (`server/src/characters.ts:201`). No separate GM builder.
- **No point-buy in v1.** Cities Without Number's skill points and Cairn's optional gear packages are real and are not v1. Naming them here is the point: v1 is honest about which books it can finish.
- **Portraits stay where they are.** The wizard's last step can open the existing upload; it does not gain a picture path of its own.
- **One wizard per system, not per room.** A room does not edit its system's creation steps. If that turns out to be wanted, it is a Room Config overlay in the shape room items already have, and it is not this.
- **No versioning of a half-built character against a reinstalled system.** An install replaces a system in place. A draft whose step ids have gone is dropped back to a plain sheet with what it had already written, in the shape `effectiveRules` drops a setting for a rule that no longer exists.

---

## What exists today

### Making a character

`createCharacter` (`client/src/CharacterModal.tsx:329`) posts a name and nothing
else; `POST /rooms/:roomId/characters` (`server/src/characters.ts:201`) inserts a
row with an empty `sheet_json`, and the player types into the sheet from there.
The sheet is drawn from `characterSheet`, autosaved every 500 ms, and validated
by nothing except `sheetSchema`'s 250 KB cap (`server/src/characters.ts:42`).
Warnings are advisory and computed on read.

That is the whole of it. There is no creation flow for a player character.

### The nearest thing to a builder

Hirelings have one. `groupPage.hirelings.creationRoll` declares ability dice, HP
dice, a starting weapon, and a finishing-touches block naming a rules section and
the tables inside it; `rollHirelingCreation` (`server/src/hireling-creation.ts`)
rolls the lot in one pass and returns a sheet, and Room Config's roster has a
**Roll one** button (`client/src/RoomConfigRoster.tsx:257`).

It is the right shape and the wrong size. It is one atomic roll with no choices,
no ordering, no resumption, and no way to look at a result before taking it —
because a hireling is a supporting character and a PC is not. Everything it does
well is worth keeping: server-side dice, tables read from the system's own
catalogue, the weapon stowed in a slot rather than written into a field of its
own.

**And it has a hard limit worth knowing about.** `compactTablesFromTables`
(`server/src/roll-tables.ts:39`) reads `row.cells[0]` and discards every other
column. Monolith's finishing touches are repeated `Roll | Result` pairs, which
the shared parser flattens into one column, so this has never mattered. Cairn's
`Name & Background (d20)` has four distinct columns and its `Character Traits
(d10)` has ten. A builder that reuses this adapter as it stands cannot build a
Cairn character at all.

### What the machinery already gives you

| Thing                    | Where                                                           | What it is good for here                                      |
| ------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------- |
| Dice                     | `rollDice` (`server/src/dice.ts:35`)                            | Every roll a step makes                                       |
| Saves                    | `evaluateSave` (`server/src/dice.ts:83`)                        | Monolith's "make a WIL save; on failure, roll a vice"         |
| Tables                   | `parseRollTables` (`shared/src/roll-tables.ts:179`)             | The rows, the die, the columns, the heading path, the linking |
| Installed tables         | `tablesForSetJson` via `compactTables`                          | Reading a system's committed `tables/*.json` at runtime       |
| Item catalogue           | `characterItemsFor` (`server/src/character-items.ts:140`)       | Matching a book's gear line to a real, room-aware item        |
| Vices                    | `characterVicesFor` (`server/src/character-vices.ts:11`)        | A `vices` field's own vocabulary                              |
| Rules excerpts           | `findRuleExcerpt` (`client/src/rules.ts`)                       | Showing the step's own passage beside it                      |
| Install cross-references | `refuseUninstallableBundle` (`server/src/system-install.ts:73`) | Where the new checks go                                       |
| A bounded vocabulary     | `SYSTEM_RULE_FEATURES` (`shared/src/system-rules.ts:16`)        | The pattern `SYSTEM_CREATION_STEPS` copies exactly            |

### What is missing

- **No multi-column table read.** Covered above; it is the first thing to fix and it fixes itself for the roller too.
- **No way to enumerate headings under a heading.** `npcCatalog` reads entries under one heading at a fixed level; nothing reads "the twelve sections under `BACKGROUNDS`, each with its prose and its tables".
- **No two-axis table.** Monolith's Gear Packs is a matrix — highest ability score down the side, HP across the top, and split into two tables because it did not fit the page. The parser has no notion of it. Out of scope; see the open questions.
- **No prose-to-gear read.** The bullets under `#### STARTING GEAR` are Markdown list items, not a table.
- **No draft state on a character.** Nothing on `characters` can say "this one is three steps into being made".

---

## Three books, and why the vocabulary is what it is

This is the table that justifies every step kind below. Nothing in the design
exists because it seemed general; each row is a thing one of these books does.

| Book                      | Scores                                                                                    | Identity                                                                              | Health        | Package                                                        | Gear                                                         | Extras                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| **Monolith**              | 3d6 ×3 in order, swap any two                                                             | 5 finishing-touch tables + a first-name table chosen from three, and a surname        | 1d6 HP        | 1 of 12 backgrounds, each with 3 tables of its own             | 4 fixed items + 3d6 credits, plus the background's bullets   | WIL save → d10 vices; group debt (shared)              |
| **Cairn**                 | 3d6 ×3 in order, swap any two                                                             | one d20 table, three of its four columns; one d10 table, all ten columns; age 2d20+10 | 1d6 HP        | none — background is a column of a table                       | 3 fixed items + 3d6 gold, then one roll on each of ~6 tables | d100 spellbooks when a gear roll says so               |
| **Cities Without Number** | 3d6 ×6 in order with one score replaceable by 14, **or** assign the array 14/12/11/10/9/7 | name and goal are free text                                                           | 1d6 + CON mod | 1 of ~20 backgrounds, each with a free skill and growth tables | \$500 of gear, plus one item under \$1,000                   | skill points, edges, foci with levels, 4 derived saves |

Read down the columns and the shape falls out. Every book rolls dice into score
fields. Every book rolls on tables for identity, and two of the three need a
named column. Two of the three choose one of a set of packages, where the package
is a heading in the book that owns further tables. All three grant fixed starting
gear. One derives numbers from other numbers. One spends points.

Read across and the honest conclusion falls out too: **v1 builds a Monolith
character and a Cairn character end to end, and gets a Cities Without Number
character as far as its skills.** That is stated as a target, not discovered
afterwards.

---

## The declaration

```jsonc
{
  "characterCreation": {
    "label": "Build a character",
    "rulesQuery": "CHARACTER CREATION",
    "steps": [
      { "id": "scores", "kind": "roll-scores", "label": "Ability scores", ... },
      { "id": "background", "kind": "packet", "label": "Background", ... }
    ]
  }
}
```

Every step carries `id`, `kind`, `label`, an optional `hint`, an optional
`rulesQuery` naming the passage to show beside it, and an optional
`optional: true`. The `id` is what the ledger records against and is as permanent
as an optional rule's id, for the same reason.

### The step kinds

`SYSTEM_CREATION_STEPS` in `shared/src/system-creation.ts`. Nine, and the list is
meant to stay short.

| Kind          | What it does                                                                                                 | Who needs it        |
| ------------- | ------------------------------------------------------------------------------------------------------------ | ------------------- |
| `roll-scores` | Rolls one die expression per score into a `{ currentKey, maximumKey }` pair, then lets the player rearrange  | all three           |
| `roll-table`  | Rolls a named table from the system's own catalogue, one roll per named `column`, into fields or a text join | all three           |
| `packet`      | Choose one of the sections under a heading; roll every rollable table it owns; offer its gear                | Monolith, CWN       |
| `grant`       | Puts fixed items into list slots, matched against the room's catalogue where the name matches                | all three           |
| `save`        | Makes a declared save against a sheet key and branches to a nested step on one outcome                       | Monolith            |
| `derive`      | Writes a field from other fields using one closed operation                                                  | CWN                 |
| `set`         | Writes constants — level 1, XP 0, armour 0                                                                   | all three           |
| `text`        | A field the player types: name, goal                                                                         | all three           |
| `rules`       | A passage of the book with nothing to fill in — principles, "what your background means"                     | optional everywhere |

**`roll-scores`** takes `scores: [{ currentKey, maximumKey, label, dice }]` and
offers two ways to fill them in.

**Roll the dice**, then optionally `rearrange` what they gave you:

- `{ "kind": "swap", "count": 2 }` — Monolith and Cairn: roll in order, swap any two.
- `{ "kind": "substitute", "value": 14, "count": 1 }` — CWN: replace one rolled score.

**Or take the `array`** — `{ "values": [14, 12, 11, 10, 9, 7] }` — and assign it
across the scores as you like. CWN offers this beside the dice.

The array is deliberately **not** a third `rearrange`, and the distinction is
load-bearing rather than tidy. A rearrangement is checked against the multiset
the dice produced; an array checked that way would reject every assignment of
itself, leaving a step that rolls numbers the player can never keep. Taking the
array is choosing not to roll. It is also why CWN's "if an array is used a score
may not be substituted with a 14 later" needs no rule of its own here:
substitution belongs to the path that rolled.

Either way the assignment happens in the browser over numbers the server
produced, and the server checks what comes back — a `swap` must be a permutation
of the rolled multiset reachable in at most `count` transpositions, a
`substitute` may replace at most `count` of them with the declared value, an
array assignment must be a permutation of the declared values. The check is cheap
and it is the only thing between the ledger and a fiction.

**`roll-table`** takes a `section` of the book and a list of rolls. Each roll
names one `table`, a `firstOf` to choose between at random, or a `fromPacket`
step and one-based `position` to read the corresponding table from the section
that packet chose. `firstOf` is how
Monolith picks among its three first-name tables and is the one piece of
`rollHirelingCreation` with no other home — the `column` to read, and the `field`
to write. A step-level `joinInto` collects every result into one field with a
separator, for Monolith's single `details` box holding five lines.

A roll naming none or more than one of `table`, `firstOf`, and `fromPacket` is
unrepresentable in the type and refused by the schema. It would reference nothing, pass every
cross-reference check there is, and then roll nothing at all.

**Where a total comes from** is its own small idea, shared by `roll-table` and by
`packet`. A table is read at a total, and that total is either rolled on the
table's own die or **taken from a step that already rolled one**: `fromStep`
names an earlier step id and reuses its result. Monolith needs it — its
background's signature gear is indexed by the Hit Protection roll, not by a
second d6 — and a step naming a later step, or a step naming one that rolled no
die, is refused at install. Nothing here computes a total; it is rolled once and
read twice.

**`packet`** enumerates and chooses one section beneath a heading. It can roll
all of that section's tables as one composite instruction, or set
`rollTablesUnder: false` and leave those tables to later `roll-table` screens
that name it with `fromPacket`. It takes:

```jsonc
{
  "kind": "packet",
  "under": "BACKGROUNDS", // the heading whose sections are the options
  "dice": "d12", // offered as a roll; the player may also just pick
  "prose": "PROFILE", // the sub-heading to show as the option's description
  "grantFrom": "STARTING GEAR", // the sub-heading whose bullets become the gear checklist
  // every rollable table the chosen section owns is rolled; `rollTablesUnder: false` turns that off
  "reuse": [{ "position": 1, "fromStep": "hit-protection" }], // read at an earlier roll instead
  "into": { "field": "background", "joinInto": { "field": "details", "separator": "
" } }
}
```

The options are enumerated from the installed tables' `origin.headingPath` and
the rules Markdown; nothing is restated in `system.json`. A section with no
tables is a valid option that rolls nothing.

**`save`** takes `{ key, type, on: "failure", then: [ ...steps ] }` and goes
through `evaluateSave` with the system's own `dice.save` rules. Monolith's vices
are the whole of the motivating case: make a WIL save, and on a failure roll d10
on the Vices table into the `vices` field. Nesting is one level deep and stays
that way; a branch that needs a branch is a book we should look at first.

**`derive`** takes `{ key, op, from, pick, value, ladder }` over the five
operations in `SYSTEM_CREATION_DERIVE_OPS`. `lookup` reads a declared
`[{ atLeast, value }]` ladder, which is CWN's attribute modifiers and nothing
more ambitious. Monolith needs only `copy`, and only for armour: a `roll-scores`
step writes both keys of the pair it rolls, so every score it touches already has
its current filled in.

### What a step may write, and what checks it

`refuseUninstallableCreation` (`server/src/system-install.ts:138`), called
immediately after `refuseUninstallableBundle` by both the install route and
`systems:validate`, and phrased the same way its checks are. It is a function of
its own because these need the bundle's rules and tables, and widening the
existing signature would have reached every caller of it.

1. Every step `kind` is in `SYSTEM_CREATION_STEPS`.
2. Step ids are unique within the system.
3. Every `field`, `key`, `currentKey`, `maximumKey`, and `joinInto` names a field the sheet declares.
4. Every `listKey` a `grant` stows into is a list the sheet declares.
5. Every `table` a `roll-table` names exists in the bundle's own `tables/*.json`, and every `column` it names is one of that table's columns.
6. Every heading a `packet` names exists in the bundle's rules Markdown.
7. A `save` names a save `type` the system's `dice.save.types` declares.
8. Every `fromStep` names a step that comes **earlier** in the list and that rolls a die of its own.
9. The sheet declares no field spelled `CREATION_NAME_KEY`, whether or not the system declares any creation at all.
10. Every dice expression a step declares can actually be rolled.
11. Every field a step writes is of a kind that can hold what the step writes into it.

Five, six, and seven are worth more than they look. A system's tables and rules
travel inside the bundle, so an install can check a table reference the way it
checks a source-document reference — which means a renamed heading is caught
before the wizard is a screen with a missing step rather than after.

Ten is checked by handing each expression to `rollDice` rather than by keeping a
second grammar beside it. `SUPPORTED_DIE_SIDES` has no d3, so a book with three
backgrounds cannot offer a rollable packet — and finding that out at install is
the entire point.

Eleven is three's other half. Three proves the key exists; eleven proves its kind
can hold what arrives. A `vices` field holds rows of `{ name, triggers,
satisfying }`, so a table result written to one as a bare string renders as an
empty box — a key that exists, a rule that fires, and nothing on the sheet.

**What eight cannot catch.** `creationSteps` flattens a save and its branch in
order, so "earlier" is well defined, but a step inside one branch may legally
name a `fromStep` inside another branch that never ran. The engine treats a total
that was never rolled as a step to skip, the same as any other unfilled step.
There is no install-time reading of which branches can co-occur, and there should
not be one.

---

## Monolith, worked

The concrete declaration lives beside the system it belongs to, in
[`../devils-toys-monolith/character-creation-plan.md`](../../devils-toys-monolith/character-creation-plan.md),
with the repository-side work it needs. In outline it is thirteen steps: roll
scores and HP, choose a background, walk its three dossier tables one screen at
a time, finishing touches, a name, the WIL save and possible vice, starting gear
and credits, then automatic defaults and armor from the equipment actually kept.

Two things it turns up that the plan above had to answer:

- Monolith has **no rollable backgrounds table**. The twelve backgrounds are `###` headings, and the book's "roll 1D12 and consult" has nothing for the roller to land on. That is why `packet` rolls the die itself against the enumerated sections rather than reading a table.
- **One roll can feed two tables.** The book says each background has "three tables, one corresponding to HP", and it is telling the truth: the first table under every background was printed with a die column reading `1 HP` … `6 HP`, and is read off the character's 1d6 Hit Protection roll rather than rolled again. Monolith's repository stripped that annotation as a table-structure repair and recorded the consequence in `rules/corrections.md` — the link now lives only in the surrounding prose. Two things follow. A step must be able to take its total from an earlier step instead of rolling one, and Monolith's declaration must roll HP **before** the background rather than in the book's printed order.

## Cairn, and what it added

Cairn's declaration lives in
[`../devils-toys-cairn/character-creation-plan.md`](../../devils-toys-cairn/character-creation-plan.md).
Thirteen steps using six of the nine kinds — no `packet`, no `save`, no `derive`,
no `fromStep`, because Cairn's book has no such shape. It is the first
declaration to use `text` and the first to write a boolean through `set`.

It was written precisely because Monolith drove the vocabulary and something had
to test it. Four things it turned up are changes rather than curiosities.

**A choice between columns, not only between tables.** `firstOf` picks one of
several tables at random — Monolith's three first-name tables. Cairn has _one_
name table with `Female Name` and `Male Name` as two of its four columns, which
is the same choice one level down. Rolling both and joining them into the name
produced a character called _Moralil Dunswallow Gruwth Wolder_, because two steps
joining one field accumulate — which is right for Monolith's `details` box and
wrong for a name. So `column` gains the same either/or `table` already has.

**A joined line says which table it came from and cannot say which column.**
Cairn's traits step rolls ten columns of one table: prefixed, it writes ten lines
all reading `Character Traits (d10)`; unprefixed, ten bare words. Row 1 of that
table is `Ambitious` under **Virtue** and `Ambitious` again under
**Reputation** — the same word meaning two different things, with the caption the
only thing between them. `prefixWithTableName` becomes
`prefixWith: "table" | "column"`.

**A rolled result cannot be offered into a slot.** `grant` stows fixed items and
`packet` offers its prose bullets as takeable candidates, but a `roll-table`
result can only be written to a field. Cairn's seven starting-gear rolls are all
inventory items and land in a text box for the player to retype. A `roll-table`
entry gains a `stowInto`, offering its result as a candidate on exactly the terms
`packet` already does — offered, never applied.

**Install check 6 is weaker than it reads.** It asks whether a `packet`'s
headings exist anywhere in the bundle's rules, not whether `prose` and `grantFrom`
exist _beneath the sections `under` enumerates_. Cairn's Optional Gear Packages
are ten headings with bullets directly under them and no sub-headings at all, so
a packet naming `grantFrom: "Starting Gear"` installs clean and yields an empty
checklist every time. The check has to descend.

Two more it names that are **not** being changed. Age is `2d20+10` and rolls
through a one-score `roll-scores`, which the wizard will draw in an ability-scores
panel — untidy, and not worth a kind of its own. And nothing branches on a table
result, so Cairn's "roll on Spellbooks if a gear result says so" is an optional
step with the condition in its hint; see the open questions.

---

## The machinery

### The schema change

One nullable column, through the `hasColumn` guard the standing schema rules ask
for:

```sql
ALTER TABLE characters ADD COLUMN creation_json TEXT;
```

It records the system it was started under, the step id the wizard is on, and per
step: the totals rolled, what was chosen, what was applied, whether it was
skipped, and how many times it has run. It is dropped to `NULL` when the last
step finishes, so a finished character carries nothing, and it is deleted with
the character by nothing at all — it is a column on the row.

**Against a step id, never a step index.** An install replaces a system in place,
and a draft recording "step 4" would go on pointing at whatever is fourth
afterwards. Ids are also what makes the tolerant reader possible, which is the
same argument `effectiveRules` makes for recording a room's optional rules
against ids.

**What a step applied is its own contribution, not the field's new value.** This
is the one part of the ledger that had to be discovered rather than designed.
Monolith's `background` and its `finishing-touches` both write into `details`: if
the ledger recorded "details now reads X", the second would clobber the first and
a reroll would append a second copy of the background's three lines. So a write
is `{ set, join, stow }` — keys written outright, lines appended to a text field,
entries appended to a list — and re-running a step takes its own previous
contribution back out by value before adding the new one. `join` and `stow` are
revertible; `set` is not, because the builder keeps no record of what a field
held before it and blanking one is as likely to discard something typed since.

Deliberately not a table: there is exactly one draft per character, it has no
rows of its own, and a JSON blob with a tolerant reader is what
`room_state.audio_json` and `rooms.calendar_json` already are for the same reason.

### The server

`server/src/character-creation.ts`, in the shape `hireling-creation.ts` has,
and `rollHirelingCreation` moves onto it: a hireling roll becomes the same
engine run over a `creationRoll` translated to steps, so there is one place that
knows how to roll a table into a field.

| Route                                                  | Does                                                                                |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `POST   /rooms/:roomId/characters/:id/creation/roll`   | Rolls the current step, writes the sheet, records the ledger, returns the character |
| `PATCH  /rooms/:roomId/characters/:id/creation`        | Records a choice, a rearrangement, a skip, or a move between steps                  |
| `POST   /rooms/:roomId/characters/:id/creation/finish` | Clears `creation_json`                                                              |

All three go through `findVisibleCharacter` and the owner check the sheet's own
`PATCH` already uses; a builder is not a new permission surface.

The resolved definition — steps with their tables expanded, `packet` options
enumerated, item catalogue attached — rides on the existing
`GET /rooms/:roomId/characters` payload beside `sheetDefinition`,
`itemCatalogue`, and `viceCatalogue`, which is where a client already looks for
what its system offers.

### The client

`client/src/CharacterBuilder.tsx`, opened from a **Build one** button beside
**New character** in `CharacterModal` (`client/src/CharacterModal.tsx:1343`),
shown only where the system declares creation.

One step per screen, because the constraint is that player workflows are
phone-ready and a five-column table of scores is not. Back and forward, a
running summary of what has been decided, the step's own passage of the book
behind a disclosure, Skip on every step, and Finish enabled from the first step
onward — leaving early is a supported ending, not an escape hatch.

The sheet it is building is visible throughout on a wide screen and one tap away
on a narrow one, drawn by `ReadOnlyCharacterSheet` — the character's real sheet,
read rather than edited. Writing to it while a step is mid-decision would give the
ledger a second author, and the wizard is a short-lived thing: closing it hands
back an ordinary sheet that has always been editable.

### Tests

`fixtures/toybox` gains a `characterCreation` declaring every step kind;
`fixtures/plainbox` declares none, so "left out" and "empty" stay tellable apart.
Both install through the real installer, as they already do, so every builder
test exercises the install checks too. Beyond that: a permutation check that
refuses a score assignment nothing rolled, a `packet` run against Monolith's real
tables, and a multi-column `roll-table` against Cairn's real ones.

---

## Phases

1. **Multi-column table reads.** Widen the compact adapter past `cells[0]`, keeping `rollHirelingCreation` on it and passing. Nothing user-visible; everything else needs it.
2. **The vocabulary and the install checks.** `shared/src/system-creation.ts`, the schema block, the install checks below, the published JSON schema regenerated. A system can declare a wizard and nothing yet runs it.
3. **The engine and the draft.** `character-creation.ts`, the column, the three routes, `rollHirelingCreation` folded in behind them.
4. **The wizard.** `CharacterBuilder.tsx`, the button, the phone layout.
5. **Monolith declares its ten steps** and is the acceptance test end to end.
6. **Cairn declares its own**, which is what proves the multi-column work and turns up whatever the Monolith-shaped design assumed.
7. **What Cairn turned up.** `columnFirstOf`, `prefixWith`, `stowInto`, and check 6 descending into the packet's own sections. Written after 6 rather than guessed at before it, which is the point of doing a second book.
8. **Docs.** A registered page in `docs/guide/`, a section in `AGENTS.md` beside the other system declarations, `changelog.md`.

Phases 1–4 are the application. 5 and 6 are data in other repositories and can
be written against a running build without touching this one, which is the point
of the split.

---

## Open questions

- **Group steps.** Monolith's shared debt is one roll for the whole company, and Cairn has nothing like it. A `scope: "group"` step writing to `group_obligations` is small; the question is whether the _first_ player through the builder rolls it, or whether it belongs where it is now — a GM action in Room Config that the wizard merely points at. v1 assumes the latter.
- **Two-axis tables.** Monolith's Gear Packs is a matrix split across two tables, and it is the book's own variant creation option. Supporting it means the parser gaining a table shape, which is a change to the roller, the editor, and the round-trip test — a plan of its own, not a step kind.
- **Point-buy.** CWN's skill points and its foci levels. It is a real interaction — a pool, a cost table, a minimum level — and it is the one thing in the three books that the nine kinds cannot express at all.
- **Does the ledger belong to the GM?** A GM might reasonably want to see that a character was rolled rather than typed, and rerolled four times. Recording it costs nothing and showing it is a decision about what kind of table this application is for.
- **Reroll the whole thing.** Starting over currently means deleting the character and pressing the button again, which is fine and is also slightly rude. A Start again that clears the sheet and the ledger together is cheap if it is wanted.
