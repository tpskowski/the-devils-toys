# Installable systems

A plan for letting an admin add a game system to a running server, without a rebuild and without touching the repository.

Today a system is a compiled npm workspace. `AGENTS.md:11` says so outright — _"Do not add runtime installation. Systems are compiled into the application."_ — and `PLAN.md` records the same as an architecture guideline. This plan reverses both, deliberately, and says what that costs.

The headline finding: **`GameSystem` is already almost entirely declarative data.** Of its twenty-odd fields, exactly one is code — `characterWarnings` (`shared/src/index.ts:853`). Everything else is JSON in a TypeScript file. That single function, three hardcoded per-system branches on the server, and a compile-time `SystemId` union are the whole of what stands between here and an installable system. This is a much smaller job than the workspace-per-system structure makes it look.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **A bundle is data, never code.** An installed system is a zip of JSON and Markdown, validated by a Zod schema, and nothing in it is ever evaluated. No `import()`, no `vm`, no plugin API. An admin who could upload JavaScript already owns the server, but shipping a mechanism that _expects_ to run uploaded JS is a different thing, and this plan does not. |
| 2   | **`characterWarnings` becomes declarative rules**, and the three built-in systems convert to them with no change in what a player sees. This is the prerequisite that makes decision 1 possible, and it is worth doing on its own merits.                                                                                                                          |
| 3   | **`SystemId` widens from a literal union to `string`.** `SYSTEM_IDS` is renamed `BUILTIN_SYSTEM_IDS` and keeps its narrow type for the code that genuinely means "the three shipped systems". The registry becomes a `Map` with a `systemOrThrow(id)` lookup, so an unknown id fails with one clear error instead of `undefined` at forty call sites.              |
| 4   | **Installed content lives under `config.dataDir`**, at `<dataDir>/systems/<id>/`, per the standing constraint that mutable files stay below the configured data directory. Built-ins keep reading `raw/` exactly as they do. One resolver, two roots.                                                                                                              |
| 5   | **A `systems` table is the registry of record.** Built-ins insert themselves on start as `origin = 'builtin'`; installed ones carry their manifest. `rooms.system` gains a foreign key to it and loses its `CHECK` constraint — which is what forces a rooms rebuild today every time the list changes (`db.ts:330-366`).                                          |
| 6   | **The template is an export of a built-in.** `npm run systems:export monolith -- --as monolith-2` writes a bundle that installs cleanly beside its source and behaves identically. That command is the authoring documentation, the scaffold for a new system, and the round-trip test, all at once.                                                               |
| 7   | **Uninstall is retirement, not deletion.** Rooms and characters reference a system id forever, and `characters.system` has no foreign key at all today. A retired system disappears from room creation, keeps every existing room working, and can only be deleted when nothing points at it.                                                                      |
| 8   | **The two remaining per-system branches on the server become declared fields.** `parseNpcStatblock` (`npc-statblocks.ts:100`) picks a named parser; the vice catalogue (`characters.ts:197`) becomes a system-declared table lookup. Neither is a new abstraction — both already have exactly the shape needed.                                                    |
| 9   | **Installing reloads without a restart.** Four caches are keyed by system id and assume immutability; each gets an invalidation hook. `starship-parts.ts:28` says in a comment that _"the raw Markdown cannot change at runtime"_ — that stops being true, and the comment is a to-do list of one.                                                                 |
| 10  | **The client stops knowing system ids.** `systemNames`, the `system === "monolith"` branches, the `"cairn"` defaults, and the theme fallback all come from the status payload it already fetches.                                                                                                                                                                  |
| 11  | **`monolith-2` is the acceptance vehicle.** A bundle produced by exporting Monolith under a new id, installed on a running server, and expected to behave identically to Monolith in every respect. It is not a fixture invented for a test — it is the real export command's real output, which is why it proves the format rather than the test.                 |

### Assumptions, flagged so you can overrule them

- **Admin only.** Installing a system is server-wide and irreversible in practice; a GM configures a room, an admin configures the server. This follows the `table-permissions.ts` split, where an admin already owns re-slugging, merging, and bundles.
- **No upgrade story in v1.** Re-installing over an existing id replaces its content and is refused if a sheet field a character already uses would vanish. Anything more — versioned migrations of `sheet_json` — is a separate piece of work and should stay out of this one.
- **Bundles pick a theme, they do not ship one.** `defaultTheme` must be a member of `THEME_IDS`. Custom themes are a real feature; they are not this feature.
- **No cross-system imports.** `contentModules` and `imports` stay declarations, as their own doc comment already says (`shared/src/index.ts:597-601`). A bundle may declare them; nothing composes them.
- **Validation defends against mistakes and malformed archives, not against a hostile admin.** Zip-slip, size caps, id charset, and schema conformance are in scope. An admin is trusted by construction.
- **The operator owns what they upload.** The bundle carries a required `license` string per source document, surfaced in credits beside the built-ins. The application does not police it.

---

## What exists today

The plan has to work with these, not around them.

### The compile-time chain

- **`SYSTEM_IDS` is a literal tuple** (`shared/src/index.ts:11`) and `SystemId` is its union (`:14`). It reaches **35 files** across client, server, shared, and the system packages themselves.
- **The registry is a frozen object literal** with three static imports: `export const systems = { cairn, monolith, cwn } as const` (`server/src/systems.ts:10`). Indexing it with a string that is not one of the three is a type error today and an `undefined` crash tomorrow.
- **Each system is an npm workspace** (`systems/*` in the root `package.json`), a dependency of `@devils-toys/server`, exporting `./src/index.ts` plus `./items` and `./traits` JSON. esbuild inlines all of it into `server/dist/index.js`.
- **The Dockerfile names each system twice** — a `COPY` per `package.json` at `Dockerfile:8-10` — and copies only `raw/*.md` and `raw/tables/*.json` into the runtime image (`:27-28`). There is no writable content path in the image except the `/data` volume.
- **`rooms.system` has a `CHECK` constraint** built from `SYSTEM_IDS` (`db.ts:16,21`), with a whole table-rebuild migration whose only job is to notice the list grew (`db.ts:330-366`). **`characters.system` has no constraint at all** (`db.ts:102`) — it is a bare `TEXT`.
- **Request validation is `z.enum(SYSTEM_IDS)`** at `index.ts:340` and `management.ts:388`, and an `includes` check in the two build scripts (`build-items.ts:29`, `build-traits.ts:19`).
- **The client parses `/rules/<system>` against the compile-time list** (`client/src/rules.ts:138`), in `main.tsx`, before any status fetch has happened. This one cannot simply read the registry — see Phase 5.

### The one function

- **`characterWarnings: (sheet) => string[]`** (`shared/src/index.ts:853`). Read all three implementations together and they use five patterns and nothing else:

| Pattern                | Cairn          | Monolith                     | CWN                                                   |
| ---------------------- | -------------- | ---------------------------- | ----------------------------------------------------- |
| Value outside a range  | armor > 3      | corruption 1–30, `*Max` ≤ 18 | ability 3–18, modifier −2–+3, skills −1–4, saves 1–20 |
| Current above maximum  | str/dex/wil/hp | hp/str/dex/wil               | hp, damage soak, system strain                        |
| Boolean flag set       | `deprived`     | —                            | —                                                     |
| List occupancy         | inventory ≥ 10 | augmentations ≥ 6 and ≥ 12   | —                                                     |
| Cross-field comparison | —              | —                            | one (`wisScore` vs a derived value)                   |

Four rule kinds cover everything but CWN's last one, and that one is a two-field comparison with a fixed operator. A vocabulary of five rule kinds retires the function outright.

### The per-system branches

- **`parseNpcStatblock`** (`npc-statblocks.ts:100`) is a ternary: `system === "cwn"` gets the labelled-pairs parser, everything else gets Cairn's inline stat line. Two named parsers, one branch.
- **`characterVicesFor`** (`character-vices.ts:6`) is already generic — it finds a table whose first column is `Vice` in whatever tables it is handed. Its only tie to Monolith is the gate at `characters.ts:197`: `context.system === "monolith" ? characterVicesFor("monolith") : []`.
- **`starshipPartsFor`** (`starship-parts.ts:29`) is fully generic already, driven by `starshipSheet` and a heading. Nothing to do but the cache.

### The client's hardcoding

Six sites, all small:

- `RulesReferencePage.tsx:8-11` — a `Record<SystemId, string>` of display names, and `:64` a theme fallback of `system === "cairn" ? "heroic" : "digital"`.
- `GroupPage.tsx:135` and `:974` — `system === "monolith"` picks the group views and a layout variant.
- `CharacterModal.tsx:1413` — a Monolith-only sheet fragment.
- `App.tsx:1644` and `ManagementWorkspace.tsx:464` — `"cairn"` as the default selection.
- `smoke.test.ts:6` — asserts the list is exactly the three.

Everything else the client knows about a system it is **already told over the wire**: `sheetDefinition` and `partyLabel` (`characters.ts:194-195`), `npcStatblock`, `initiative`, `attributeDamage`, `rangedWeaponIcon` (`encounters.ts:442-447`), `dice` and `traits` (`session-routes.ts:47-62`). The client is in good shape.

### The precedents worth copying

- **`table_sets`** is user-authored content going through the same parser as built-in content, stored as Markdown in the database, and it works. A system's tables can follow it exactly.
- **`table-bundles.ts`** is already a zip in and a zip out, using `fflate`, with a `manifest.json`, a version number, and tests that check a rejected archive is rejected for the right reason (`table-bundles.test.ts:46-73`). A system bundle is the same shape with a different manifest.
- **`mergeCatalog`** (`item-catalog.ts:103`) is the model for "the file the operator edits wins, the source only seeds it".
- **`db-migrations.test.ts`** is the model for testing a migration by writing an old database first.

---

## The bundle

```
cairn.devilsystem.zip
├── manifest.json         app, bundleVersion, systemId, exportedAt, license summary
├── system.json           the GameSystem, minus characterWarnings, plus warningRules
├── items.json            the item catalogue, as systems/<id>/items.json today
├── traits.json           the trait catalogue, as systems/<id>/traits.json today
├── rules/
│   ├── Cairn.md          every file named by a sourceDocument
│   └── corrections.md
└── tables/
    └── cairn.json        the extracted table set, as raw/tables/<file>.json today
```

`system.json` is `GameSystem` with three changes:

- `characterWarnings` is gone, replaced by `warningRules` (below).
- `sourceDocuments[].markdownFile` and `.tablesFile` are bundle-relative paths under `rules/` and `tables/`, not `raw/` names.
- Two new optional fields settle the server branches: `npcStatblock.parser: "inline" | "labelled"` (default `"inline"`) and `viceCatalog: { column: string }` (omit for a system with no vices).

Nothing else changes shape. A bundle's `system.json` and a built-in's `src/index.ts` describe the same object.

### Ids inside a bundle

Five things in a system are namespaced by its id, and all five have to move together when a bundle is authored under a new id. This is what `--as` does (Phase 6), and getting it wrong is the most likely way to produce a bundle that installs and then misbehaves quietly:

| What                                      | Monolith's value               | Notes                                                                                                                   |
| ----------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `id`                                      | `monolith`                     | The obvious one.                                                                                                        |
| `contentModules[].id`                     | `monolith/core`, `monolith/gm` | Must move with `provides` and `requires` or the dependency reference dangles.                                           |
| `contentModules[].provides` / `.requires` | `["monolith/core"]`            | `monolith/gm` requires `monolith/core`; rewriting one and not the other breaks it.                                      |
| `contentModules[].storageNamespace`       | `monolith.core`, `monolith.gm` | Reserved for module-owned character data. Two installed systems sharing one namespace is a collision waiting to happen. |
| Item ids in `items.json`                  | `monolith/spike-thrower`       | `itemId()` builds them as `<system>/<slug>` (`character-items.ts:61`), and `room_items.item_id` stores them per room.   |

Item ids deserve a note. They are stored in `room_items` and `room_retired_items`, both scoped by room, and a room has exactly one system — so an unrewritten id cannot actually collide. It would still be wrong: `itemId()` is the constructor, `seedItemCatalog` uses the prefix to decide what a system already holds, and an id that says `monolith` inside a system called `monolith-2` is a lie that will mislead the next person to read it. Rewrite them.

Table anchors need no rewriting: `rulesMarkdown` mints them as `system:${system}` at read time (`systems.ts:47`), derived rather than stored.

### Declarative warnings

```ts
type WarningRule =
  | { kind: "range"; key: string; min?: number; max?: number; message: string }
  | { kind: "not-above"; key: string; maxKey: string; message: string }
  | { kind: "flag"; key: string; whenTrue: boolean; message: string }
  | { kind: "list-occupancy"; listKey: string; atLeast: number; message: string }
  | { kind: "compare"; key: string; against: string; operator: ">" | "<"; message: string };
```

`message` may interpolate `{label}` where a rule is generated per field, which is how CWN's six abilities and four saves stay six and four lines of data rather than sixty. The evaluator lives in `shared/`, so the client can preview a warning without a round trip — a small bonus, not a requirement.

**Acceptance:** the three built-ins declare `warningRules`, `characterWarnings` is deleted from `GameSystem`, and the existing character tests pass unchanged. If a warning's wording moves by one character, the conversion is wrong.

---

## `monolith-2`, the test system

The thing to build and keep: **Monolith, exported as a bundle under the id `monolith-2`, installed on a running server, indistinguishable from Monolith in play.** It is the acceptance criterion for the whole plan, it is the demo, and it is the standing regression test.

### Why Monolith and not one of the others

Monolith is the most demanding of the three by a distance. It is the only system that exercises:

- **Starships** — `starshipSheet` with sizes, base values, and holds, plus `starshipPartsFor` reading installable parts out of the rules Markdown at runtime, behind the cache whose comment says the Markdown cannot change (`starship-parts.ts:28`).
- **Vices** — the only system the vice catalogue is enabled for, and the only thing gating it is `context.system === "monolith"` (`characters.ts:197`).
- **Both client branches** — `groupViewsForSystem` (`GroupPage.tsx:135`), the `isMonolith` page-title and layout switch (`:974`), and the Monolith-only sheet layout in `CharacterModal.tsx:1413`.
- **`traitCatalog.headings`** — three definition lists Cairn does not have.
- **`attributeDamage` with `criticalDamage`** — the mark left behind by a failed save.
- **Three of the five warning-rule kinds**, including the only two-threshold list-occupancy rule (augmentations at ≥ 6 and ≥ 12).

Cairn would prove far less. CWN would prove one thing Monolith does not — the labelled-pairs statblock parser (`npc-statblocks.ts:100`), the only remaining `system ===` branch on the server after Phase 3. Monolith declares `parser: "inline"`, so `monolith-2` leaves that path untested; a throwaway `cwn-2` install covers it in one line of a test and needs no permanent home.

The content is also the largest: `raw/Monolith.md` at 176 KB, `raw/tables/monolith.json` at 237 KB, `items.json` at 56 KB, `traits.json` at 4.4 KB — about 474 KB before compression, comfortably inside the proposed 25 MB cap, and a realistic sample of what an upload actually looks like.

### How it is produced

```bash
npm run systems:export monolith -- --as monolith-2 --out ./scratch
```

One command, no hand-editing. It applies the five id rewrites above and sets three fields so a tester can tell the two apart in a picker without changing any behaviour:

| Field       | Monolith   | `monolith-2`                                                                      |
| ----------- | ---------- | --------------------------------------------------------------------------------- |
| `id`        | `monolith` | `monolith-2`                                                                      |
| `name`      | Monolith   | Monolith (installed)                                                              |
| `shortName` | Monolith   | Monolith-2                                                                        |
| `glyph`     | as shipped | unchanged — the glyph is the visual identity, and keeping it is part of the point |

Everything else, including `defaultTheme` and every word of rules text, is byte-identical. **If `--as` needs a follow-up hand edit to produce a working system, the export command is incomplete** — that is the whole value of building the test system this way rather than writing the bundle by hand.

### What "identical" is checked against

An automated test installs the bundle into a throwaway data directory and asserts each of these matches Monolith, modulo the six renamed identifiers:

- the `/api/status` entry, including `dice` and the trait vocabulary
- `sheetDefinition` and `partyLabel` for a character
- the group definition, including `starshipSheet` and the parsed parts list
- `npcStatblock`, `initiative`, `attributeDamage`, `rangedWeaponIcon`
- the item catalogue and the trait catalogue
- `rulesMarkdown` for **both** `gm` and `player` — the player cut is where a mistake in `gmOnlyHeadings` or `contentModules` would hide
- the parsed table set, table for table
- the vice catalogue
- `warningRules` evaluated over a fixture sheet that trips every Monolith warning

### The manual pass

Worth doing once by hand, because several of these are things a payload comparison cannot see:

1. Install the bundle as an admin. Confirm it appears in room creation beside the built-ins.
2. Create a room on `monolith-2` and a character in it. Confirm the sheet has Monolith's layout — the Monolith-specific `character-layout-monolith` arrangement, not the default one. **This is the check that fails before Phase 5 lands.**
3. Confirm the Group tab offers Monolith's views, not the standard two.
4. Build a starship, choose a size, install a bulky part, confirm it spills into the following hold.
5. Confirm the vice list is populated.
6. Fill a sheet badly enough to trip each warning.
7. Open the rules reference at `/rules/monolith-2` as a player and confirm the GM-only chapters are absent.
8. Retire it. Confirm the room still loads and the system is gone from creation. Restore it.
9. Attempt to delete it. Confirm the 409 names the room.

### What it changes about the sequencing

Steps 2 and 3 fail on a server that has Phases 0–4 but not Phase 5, because the two client branches test the literal string `monolith`. A `monolith-2` room would render with the default sheet layout and the standard group views — a system that installs, reports itself correctly over the wire, and then quietly looks wrong.

The first draft of this plan had Phase 5 as client tidying that could follow a release later. It cannot: **Phase 5 is part of the first shippable increment**, and picking `monolith-2` as the test system is what made that obvious rather than something to discover in use. See _Sequencing_.

There is a compile-time edge to the same problem: `GroupView` is derived from `MONOLITH_GROUP_VIEWS` (`GroupPage.tsx:132`), so the group views are not merely branched on at runtime, they are baked into a type. Phase 5 has to widen that type, not just replace the ternary.

---

## Work

### Phase 0 — Widen the type — **done**

Nothing user-visible. Everything after this depends on it, and it is the phase most likely to surface a surprise.

- `SYSTEM_IDS` → `BUILTIN_SYSTEM_IDS`; `type SystemId = string`. `SYSTEM_ID_PATTERN` and `isSystemId()` are new, in `shared`, so the client can judge an id's shape without knowing what exists.
- `systems.ts` holds a `Map<string, GameSystem>` behind `systemOrThrow`, `hasSystem`, `allSystems`, `systemIds`, `registerSystem`, and `unregisterSystem`. Every `systems[x]` became `systemOrThrow(x)` — 46 call sites across 13 files. `builtinSystems` stays exported for the two table-equivalence tests, which check `raw/` content and so genuinely mean the compiled three.
- `z.enum(SYSTEM_IDS)` → `systemIdSchema`, which asks the live registry and rejects with `No such system: <id>.` Being a request-time check, it accepts a system installed since the process started.
- The `CHECK` on `rooms.system` is **dropped, not widened**, and the migration detects the constraint's own presence in `sqlite_master` — which is what makes it idempotent.

**Acceptance met:** typecheck clean, 354 unit tests and all 16 smoke tests pass. `server/src/systems.test.ts` covers the registry, including that `systemIdSchema` rejects `monolith-2` before registration and accepts it after, with no restart.

**Worth knowing:** the first version of the migration test passed against an unmigrated database, because the _theme_ half of the same rooms rebuild was carrying it. `seedLegacyDatabase` now takes its theme list, so the two isolated tests seed current themes and can only be satisfied by the system half. Both were confirmed to fail with the migration disabled.

### Phase 1 — Declarative warnings — **done**

Per the section above. Independent of Phase 0 and done alongside it.

- `shared/src/character-warnings.ts` holds four rule kinds — `range`, `flag`, `list-occupancy`, `compare` — and the evaluator. `not-above` folded into `compare` rather than earning its own kind, since a current value against its maximum is the same comparison with a different message.
- `compare` grew `scale`, `offset`, and `beyond` to carry CWN's encumbrance rules, which are the only derived thresholds in any of the three books: readied load against half of Strength, with a second sentence once the load is past the extended-hauling allowance.
- `list-occupancy` tiers are exclusive and evaluated highest-first, which is what reproduces Monolith's `else if` between the sixth and twelfth augmentation socket.
- The built-ins still build their rule arrays with ordinary TypeScript — CWN maps six abilities into twelve rules — because what they build is data. Only a bundle needs them flattened to JSON.

**Acceptance met:** the conversion was checked by running the old functions and the new rules over **3409 generated sheets** covering every boundary in all three systems. Two sheets differed, both intended: `{corruption: ""}` and `{corruption: null}` no longer warn under Monolith.

**One deliberate behaviour change.** CWN's `numeric` already refused `""`, `null`, and booleans before calling `Number`; Cairn's and Monolith's did not, and `Number("")` is `0`. So a Monolith sheet with an untouched corruption box reported _"Corruption is normally recorded from 1 to 30."_ The shared reader takes CWN's stricter version, which is the right semantic — a blank field is not a recorded zero — and `server/src/character-warnings.test.ts` pins it.

The three tests that asserted `toHaveLength(n)` now assert the exact sentences in order, since a count cannot tell a faithful conversion from a reworded one.

### Phase 2 — Resolve content by system, not by path — **done**

- Add `server/src/system-content.ts`: `rulesFile(system, name)`, `tablesFile(system, name)`, `itemsFile(system)`, `traitsFile(system)`. Each checks the system's origin and returns either `projectFile("raw", …)` / `projectFile("systems", id, …)` or `path.join(config.dataDir, "systems", id, …)`.
- Route the six existing readers through it: `systems.ts:31`, `table-json.ts:40`, `item-catalog.ts:10`, `trait-catalog.ts:19`, `item-catalog.ts:39`, `trait-catalog.ts:44`.
- Installed items and traits are read from disk, not inlined — which is why `AGENTS.md:39` warns about the esbuild inlining. Built-ins keep the inlined path; only installed systems hit the filesystem.

**Acceptance met:** `server/src/system-content.test.ts` pins every resolved path for all three built-ins to the literal path the module it replaced was building. 359 unit tests and all 16 smoke tests pass.

**What the phase actually needed beyond the sketch above:**

- **`builtin-systems.ts`, to break a cycle.** The resolver must know whether a system is compiled in; the registry must know where its content lives. The three static imports and that one question moved into their own module, which both import.
- **`isBuiltinSystem` uses `Object.hasOwn`, not `in`** — which is what `unregisterSystem` had been using. `"constructor" in builtinSystems` is `true`, so a system with that id would have had its content looked for in the repository, and `unregisterSystem` would have refused to remove it. Neither is reachable today, because `SYSTEM_ID_PATTERN` permits both spellings and nothing else stops them. There is a test.
- **`readSetJson` takes the system and keys its cache on it.** The filename alone was enough while every set lived in `raw/tables`; two installed systems may both call their set `tables.json`. `forgetSetJson` is the Phase 4 invalidation hook, written now because the cache key was already being changed.
- **The catalogues stopped reading the rulebook themselves.** `catalogFromRulebook` and `traitsFromRulebook` each held their own copy of the three lines `systemMarkdown` already had; both now call it, so the resolver only has to be right in one place.
- **`characterVicesFor` asks the registry** whether it was handed a system or Markdown, rather than naming the three systems it knew about. One of the hardcoded branches Phase 3 was going to have to remove, removed early because its call site was already being touched.

### Phase 3 — The registry table and the install route — **done**

```sql
CREATE TABLE IF NOT EXISTS systems (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('builtin','installed')),
  retired INTEGER NOT NULL DEFAULT 0,
  manifest_json TEXT NOT NULL DEFAULT '{}',
  installed_by INTEGER REFERENCES accounts(id),
  installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Built-ins upsert themselves on every start, so the table is never authoritative _about_ them — it exists so a room can point at a row and so installed systems have somewhere to live. `rooms.system` gains the foreign key; `characters.system` gains one too, which it should have had regardless.

Routes, all admin-gated in one module (`server/src/system-permissions.ts`, following `table-permissions.ts`):

- `GET /api/admin/systems` — the registry, with a per-system in-use count.
- `POST /api/admin/systems` — multipart upload, `multer` as `media.ts` does, size-capped by a new `DEVILS_TOYS_SYSTEM_UPLOAD_LIMIT_MB` (default 25).
- `POST /api/admin/systems/:id/retire` and `/restore`.
- `DELETE /api/admin/systems/:id` — refused with a 409 naming the rooms and characters that hold it.
- `GET /api/admin/systems/:id/export` — a bundle out, for every system including built-ins.

Install is: unzip → schema-validate → id checks → write to a staging directory under `dataDir` → atomic rename → insert row → reload. A failure at any step leaves nothing behind.

Validation, in order, each with its own message:

1. `manifest.json` present, `app === "devils-toys-system"`, known `bundleVersion`.
2. Every entry path is relative, has no `..` segment, and lands under a permitted subdirectory. (Zip-slip. `table-bundles.ts` gets this right; copy it.)
3. `system.json` parses against the Zod schema for `GameSystem`.
4. `id` matches `/^[a-z][a-z0-9-]{1,31}$/` and is not already taken by a built-in.
5. `defaultTheme` ∈ `THEME_IDS`; every `sourceDocuments[].markdownFile` and `.tablesFile` is present in the archive; every `characterSheet.lists[].key` is unique; `npcStatblock.hitPointsKey` names a declared field; `warningRules` reference declared keys.
6. Table JSON parses with the existing `readSetJson` validator.

**Acceptance met:** each numbered check has a test feeding it a bundle that fails only that check, in `system-bundles.test.ts` and `system-install.test.ts`. Both check modules are tested first against all three compiled systems, renamed and bundled — a rule Monolith itself fails is a wrong rule, not a bad system. 405 unit tests and all 17 smoke tests pass.

**`scripts/systems-smoke.mjs` is the phase's real acceptance**, and it is the plan's `monolith-2` in full: export, install on a running server, check the sheet definition, party label, vices, gear, dice, traits, and theme against Monolith's, read the rules as GM and as player, then retire, fail to delete, restore, replace, and delete.

**What the sketch above missed:**

- **`character-items.ts` held a hardcoded map of the three esbuild-inlined catalogues.** An installed system's items and traits were simply absent, and `/api/status` returned 500 the moment one existed. This is the case `AGENTS.md:39` warns about from the other direction: built-ins keep the inlined path so the Docker image still needs no extra files, and only an installed system reads from disk. Found by the smoke test, not by any unit test — nothing below the route had ever asked for a system that was not compiled in.
- **Phase 4's cache invalidation had to come with it.** An install that needed a restart is not an install, so `forgetSystemContent` and the four hooks landed here rather than in their own phase.
- **The tables server needs `loadInstalledSystems()` too.** It lists one table set per system and starts independently of the game server, so it would otherwise have shown an installed system's rooms but not its tables.
- **Retirement had to reach three places, not one**: `/api/status` stops offering the system, `POST /api/rooms` refuses it with a 409, and the admin list still shows it. Only the first was in the sketch.
- **`renameSystem` must leave a capability namespace alone.** CWN's modules provide `without-number/core@1`, which names a family rather than a system; rewriting it would have broken the very compatibility declaration it exists for.
- **The exported rules differ from the original by design.** `rulesMarkdown` mints table anchors as `system:<id>` at read time and writes them URL-encoded, so `monolith-2`'s book is Monolith's byte for byte apart from those. The smoke test normalises exactly that and nothing else, which is a stronger assertion than equality would have been.

### Phase 4 — Reload without a restart — **mostly done in Phase 3**

The four invalidation hooks and `forgetSystemContent` landed with the install route, because an install that does not take effect is not one. What remains is the `systems-updated` realtime broadcast, so a client with the room list open notices a new system without a refresh.

Four caches assume a system's content cannot change:

| Cache                        | Where                                    | Note                                                          |
| ---------------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| `linkedRules`                | `systems.ts:40`                          | substituted rules Markdown per system                         |
| `cache` (set JSON)           | `table-json.ts:35`                       | keyed by filename, not system                                 |
| `cache` (starship parts)     | `starship-parts.ts:29`                   | carries the now-false comment                                 |
| item / trait catalogue reads | `item-catalog.ts:14`, `trait-catalog.ts` | `readFileSync` per call today — no cache, so nothing to clear |

Give each an exported `invalidate(systemId?)` and call them from one `reloadSystems()` that also re-reads the registry. Broadcast a `systems-updated` realtime event so open clients refetch `/api/status` — the mechanism already exists (`realtime.ts`, `broadcastRoom`), and this is the one case that wants a server-wide broadcast rather than a per-room one.

**Acceptance:** a test installs a bundle, reads its rules, re-installs with changed Markdown, and reads the change without a process restart.

### Phase 5 — Client de-hardcoding — **done**

- `systemNames` and the theme fallback come from the status payload; `RulesReferencePage` fetches `/api/status` before rendering, as the rest of the client already does.
- `rules.ts:138` stops validating against a compile-time list. Match `/^[a-z][a-z0-9-]{1,31}$/` and let the server's 404 be the answer — the route only decides which component to mount, and mounting the rules page for a bad slug shows an error either way.
- `GroupPage.tsx:135` — `groupViewsForSystem` reads the views from `groupPage` in the payload. The definition already carries `sections`; the Monolith branch exists because starships were added before the definition could express them. `GroupPage.tsx:974` and `CharacterModal.tsx:1413` become checks for the presence of the relevant definition rather than for the system's name — `starshipSheet` and the obligations section are what those branches are really asking about.
- `GroupView` (`GroupPage.tsx:132`) is derived from `MONOLITH_GROUP_VIEWS`, so this is a type change, not only a ternary. Widen it to the view ids the definition declares.
- Defaults become "the first system the server offered".
- `smoke.test.ts:6` asserts the built-in list, which is now `BUILTIN_SYSTEM_IDS` and still exactly three.

**Acceptance met:** nothing in `client/src` matches a system id. The smoke test checks the two payloads the browser draws from — the sheet's declared layout and the group definition's rosters — so steps 2 and 3 of the manual pass are covered by an automated one. 406 unit tests and all 17 smoke tests pass.

**Two things the sketch treated as branches turned out to be missing declarations:**

- **Obligations had none at all.** The roster, its rows, and its routes all existed; the client showed it for Monolith by name and for nobody else. It is a declared field now, and that is what gives it a tab. Monolith's `groupDebt` textarea — the field it replaced — went with it: its data had already been migrated into rows and the key stripped from the group blob, so it was a field nothing rendered sitting beside the roster that superseded it.
- **The four-rail sheet arrangement is a layout, not a system.** A sheet now names which sections sit on the left rail, which is highlighted, and what shares the right rail with which lists; everything unnamed falls in the middle. The client knows how to draw it and a system chooses it — the same principle as the theme decision, which is why it does not violate it.

**`GroupView` was a type, not just a branch**, exactly as flagged: it was derived from `MONOLITH_GROUP_VIEWS`, so a system could only have the tabs Monolith has. `groupViewsForDefinition` moved to `shared/` beside `groupAssetDefinitions`, so the server can test it against the real definitions while the client tests the derivation.

**Rooms now carry their system's display name**, read from the registry rather than the definition, so a room on a retired system — or one whose bundle will not load — still says what it is instead of showing a bare id.

### Phase 6 — Export, scaffold, and docs

- `npm run systems:export <id> [--as <newId>] [--out <dir>]` — writes a bundle for any registered system, built-in or not. Without `--as` it is a faithful export, for backup and for the round-trip test. With `--as` it is also the scaffold: it applies the five id rewrites and produces a bundle that installs alongside its source. This one command is decision 6, and it is what produces `monolith-2`.
- `npm run systems:validate <bundle>` — the install validation, offline, so an author iterates without a server.
- **Admin UI**: a section in `ManagementWorkspace` — the list, an upload control, retire/restore, export, and the in-use count that explains why delete is refused. It is a table and a file input; it does not need a page of its own. Built-ins appear in the list too, marked, exportable, and not retirable.

**Acceptance:** `monolith-2` is produced by `systems:export` with no hand edit, installed through the admin UI, and passes the full manual pass.

- Docs, all of which currently state the opposite:
  - `AGENTS.md` — rewrite `Adding new systems`. Point 7 inverts; points 1–6 stay as the guidance for a system that ships _in_ the repository, which is still the right home for one that is maintained alongside the code.
  - `PLAN.md` — the architecture guideline _"Install game systems at build time from repository folders. Runtime system installation is deferred."_
  - `docs/guide/admin/` — a new page, in the voice of the existing ones.
  - `README.md`, `changelog.md`, `credits.md` (installed systems' attributions).
  - `Dockerfile` — unchanged for built-ins, but the `/data` volume now holds content, which the deployment doc's backup procedure must say.

---

## Testing

The round-trip is the spine of it, and `monolith-2` is the round trip: **export a built-in, install it under a fresh id, and assert every payload matches the original's.** The full checklist is in the `monolith-2` section above. If Monolith-installed-as-`monolith-2` is indistinguishable from Monolith, the bundle format is complete — and that test catches every field this plan might have missed, which is exactly the risk in a format that has to carry an entire type by hand.

Run the same export-and-compare over Cairn and CWN in the automated test without keeping their bundles: Cairn covers a system with no `traitCatalog` and no starships, and CWN covers the labelled statblock parser and the widest set of warning rules. Only `monolith-2` is kept as an artifact.

Beyond it:

- One rejection test per numbered validation check (Phase 3).
- Warning-rule conversion: the existing character tests, unchanged, as the regression suite.
- Migration: an old database with the `CHECK` constraint in place, per `AGENTS.md:80` — confirm the test fails when the migration is removed.
- A smoke script, `scripts/systems-smoke.mjs`, added to `npm run smoke`, running the `monolith-2` manual pass end to end: install, create a room, create a character, read the player rules cut, retire, confirm the room still loads, confirm delete is refused, restore.

### Where the bundle lives

`monolith-2` is a build artifact, not source: it is reproducible from `npm run systems:export` at any time, and a 130 KB zip of rules text already in `raw/` has no business in Git. The test builds it from the live Monolith definition on each run, which also means it cannot rot — a field added to `GameSystem` and forgotten in the export shows up as a failing comparison the same day.

For hand testing, `scratch/` is already gitignored and is where it should land.

## What this does not do

Stated so the boundary is a choice rather than an omission:

- **No sheet migration.** Re-installing a system that drops a field a character has written to is refused, not migrated.
- **No cross-system imports**, though a bundle may declare them.
- **No custom themes, no custom CSS, no client-side extension.** A bundle cannot change how anything looks beyond picking a shipped theme.
- **No system marketplace or remote fetch.** A file, uploaded by an admin.
- **No per-room system overrides.** A room's system still cannot change after creation.

## Sequencing

Phases 0 and 1 are independent and are the whole of the risk — they touch every system-aware file, and they land with no visible change. Phase 2 is small and mechanical. Phase 3 is the feature.

**Phases 0–5 plus the export half of Phase 6 are one increment**, and `monolith-2` is what defines its edge. Stopping earlier produces a system that installs, reports itself correctly over the wire, and then renders with the wrong sheet layout and the wrong group views — which is worse than not shipping it, because it looks like it worked. Phase 4 is in for the same reason at a different layer: a system that needs a server restart to take effect gets installed wrong once and mystifies its admin.

What can follow later is the rest of Phase 6 — the admin UI beyond a bare upload control, `systems:validate`, and the documentation rewrite. Installing by dropping a bundle through an API call is a perfectly good first version for a server whose admin is also the person who built the bundle.
