# Project guidance

## Game systems

This repository is the tabletop and ships no game system. Each one lives in a
repository of its own — `../devils-toys-<id>` — and is installed at runtime. If
you are about to add a `systems/` workspace, that is the change this structure
exists to prevent.

- A system is **data, never code**. `system.json` is the whole of its behaviour and every field in it is declarative: a player warning is a `warningRules` entry, not a function. That is what makes a system installable at all, and it is why nothing read from one is ever evaluated, imported, or executed.
- A system repository holds `devilsystem.json` (the marker), `system.json`, `items.json`, `traits.json`, `rules/`, and `tables/`. Everything else in it — README, licence, workflows, notes, the book itself under a gitignored `source/` — is the author's and is ignored on install.
- Installed content lives under `<dataDir>/systems/<id>/` **and** is registered in the `systems` table. Both are required; copying a directory into place is not an installation.
- Installing over an id replaces its content atomically and invalidates every system-content cache. A failure leaves the previous content and row untouched.
- Retirement removes a system from new-room choices and leaves existing rooms usable. Deletion is only for a system nothing points at.
- `builtinSystems` is empty and the concept is kept deliberately: it still draws the line between content read from this repository and content read from the data directory, and it is where a system would go if one ever shipped in the image again.

### Working on a system from here

`fixtures/toybox` and `fixtures/plainbox` are system repositories in the same
shape as any other, so the same commands work on all of them. A path is resolved
against this repository's root.

```
npm run systems:validate -- ../devils-toys-cairn     # exactly what an install checks
npm run systems:catalog  -- ../devils-toys-cairn     # rebuild items.json and traits.json from the book
npx tsx scripts/tables-md-to-json.ts --repo ../devils-toys-cairn [--check]
npm run systems:export   -- <installed-id> --out ../devils-toys-<id>
npm run systems:schema                                # regenerate the published JSON Schema
npm run fixture:build                                 # both of the above, for the fixture
```

**Rebuild tables with `--repo`, never with `--in`/`--out`.** The pair cannot see
`gmOnlyHeadings`, so it writes tables carrying no `classification` — and a table
with no classification is refused to _players_, not to the GM. A system rebuilt
that way looks right to whoever rebuilt it and has silently lost every table its
players could reach.

### The test fixtures

The suite cannot borrow a system, so it brings two. `toybox` declares everything
optional a system may declare — group page, hirelings, assets, attribute damage,
vices, traits, a sheet layout, qualified save outcomes. `plainbox` declares none
of it. Much of what the application does is only visible across a _pair_ of
systems — an item may not be copied into a room on another system, a config
section is offered by one and not another — which is why there are two, and why
"left out" and "empty" can be told apart at all.

Both are installed through the real install path rather than injected, so every
test that needs a system also exercises the installer.

### Importing from a repository

- Fetching is the only outbound connection this server makes. `DEVILS_TOYS_SYSTEM_HOSTS` is the allowlist and it is re-checked on **every redirect**, not once — codeload redirects to an object store, and checking once at the start is exactly how an allowlist is walked out of.
- An archive is capped as it is read, not measured afterwards, and a path that climbs out of the archive is refused outright rather than filtered out. Do not let the set of files we read become the thing that provides that guarantee.
- Everything after the download is the code an uploaded bundle already goes through. Arriving over the network buys no trust.

### A system's version

- The version lives in `devilsystem.json` and is the **author's word**. Nothing derives one from a tag, a commit, or a hash, which is why `buildSystemRepoMarker` cannot produce one from a `GameSystem` and takes it as an argument instead, and why `systems:export` reads it off the installed row. It is optional: a system without one is _unversioned_, not invalid, and its rooms keep working.
- `recordedSystemVersion` in `server/src/system-repo.ts` is the rule — the marker first, the catalogue entry only as a fallback. The catalogue is one reader of an author's release rather than the authority on it, and a repository imported by hand has no entry at all. Do not reintroduce a comparison against the catalogue's string for a system that is installed: a stale entry becomes a permanent "Update to 1.1" that pressing the button can never clear, because the install writes the marker's version straight back.
- `compareSystemVersions` claims `newer` only where **both** sides read as dotted numbers and the upstream one is greater; everything else is `same` or `differs`. A version scheme that is not `MAJOR.MINOR.PATCH` — `2026-08`, `1.0.0-rc1`, `v2` — will therefore only ever report as different, and offer **Reinstall** rather than an update. That is the consequence of the rule, not a gap in it.
- The check reads the marker over HTTP — `markerUrl` builds `raw.githubusercontent.com/<repo>/<ref>/devilsystem.json` — rather than the tarball. That is one small file per system per page load, on the host the allowlist already carries for the catalogue, and it is why this needs no new host and no API. Pulling an archive to read six lines would be the whole system, per system, every time an admin opens Systems.
- **Bumping the version is what makes an update visible.** A release that does not bump it is a release nobody is offered, so bump `devilsystem.json` in the system's repository as part of publishing one.
- A format-2 marker may declare `breaking: true` with non-empty plain-text `releaseNotes`. The declaration belongs to the incoming release and means replacing a different release under the same id needs an administrator's acknowledgement; it does not obstruct a first install, and the exact accepted release does not ask twice. The acknowledgement fingerprint covers the system id, version, flag, and notes, and the shared pre-write install boundary enforces it for repositories, the catalogue, updates, and uploaded bundles alike. Keep v1 readable but strict: an old-format marker or manifest carrying v2 release fields is refused rather than silently losing its warning, and old application builds refuse format 2 for the same reason.

## Optional rules and the features they switch on

- A system declares what it **offers** rather than imposes in `optionalRules`, and each rule names the `feature` it switches on. Nothing anywhere reads a rule's id to decide what it means: the id is only what a room's setting is recorded against, and `SYSTEM_RULE_FEATURES` in `shared/src/system-rules.ts` is the list of behaviours the application knows how to withhold. A rule naming a feature this build does not have is refused at install rather than ignored, because a system whose tags silently never appear is worse than one that will not install.
- A rule marked `required` is on in every room and is drawn as a sentence rather than a switch. A switch that cannot move is a lie, and a GM cannot un-declare what their game is played by.
- A room records only where it has **moved** a rule, in `room_system_rules`. That is what keeps a default meaningful, and what makes `effectiveRules` — the room's setting, then the rule's default, then on regardless where required — the one place that resolves it. A setting recorded against a rule the system no longer declares is dropped on read and left in the table: an install replaces a system in place, and a rule that goes missing in one version and returns in the next comes back as the room left it.
- Ask `roomHasFeature` on the server rather than sending a client the rules and trusting it to work them out. A room with a feature switched off has no routes for it at all, which is why nothing can be written that the room would never show.

## Tags

- Tags are a room's own words on the things in it — characters, NPCs, hirelings, and the Library — and they exist only where the system's optional rules switch them on. They are **not** the table editor's tags: that vocabulary is a database table an admin curates so two sets can be browsed together, and this one is read back out of the tags in use so a table settles on its words by using them.
- `room_tags` carries a column per kind with a CHECK that exactly one is set, the shape `encounter_combatants` already uses. It is the only way a tag can carry a real foreign key, so a deleted NPC takes its tags with it rather than leaving rows a later NPC with the same id would inherit.
- A tag row is the room's, including on a character. A character belongs to a player and travels between rooms; tags are the table's notes on its own game, so two rooms tag the same character differently and neither sees the other's words.
- What a reader is sent is decided by role, in `readRoomTags`: a GM sees the room, and a player sees their own characters, the party's hirelings, and the Library entries revealed to them. The vocabulary is read from what that reader was sent, so it cannot leak the words on the cast they have not met.
- A subject's tags are written whole rather than a tag at a time. The editor sends the list it is showing, so a tag someone else removed while this one was typing loses to whoever saved last rather than coming back on its own.

## Character creation

- A system's creation chapter is data like everything else it declares. `SYSTEM_CREATION_STEPS` in `shared/src/system-creation.ts` is the list of behaviours this build can perform, beside `SYSTEM_RULE_FEATURES`, and a step naming a kind this build has not got is refused at install rather than ignored — for the reason a rule naming an unknown feature is, since a wizard whose third screen silently never appears is worse than one that will not install. The whole of it is optional: a system that declares none keeps the blank sheet and the placeholder name, and that is still a perfectly good way to make a character.
- `refuseUninstallableCreation` in `server/src/system-install.ts` is where the cross-references are checked, and it runs on the install route and on `systems:validate` alike. It reads the bundle's own rules and tables, so a table, a column, a packet's heading, a save type, or a dice expression that has moved is caught by whoever installs the system rather than by a player looking at an empty screen. Two of them are worth knowing before you write a declaration: a `packet`'s `prose` and `grantFrom` are looked for _beneath the sections it enumerates_ rather than anywhere in the book, and a `fromStep` must name an earlier step that rolls a die of its own.
- A step writes fields the sheet declares, lists the sheet declares, and `CREATION_NAME_KEY` — `$name`, the character's own name, which is a column on the row. Nothing else, and a sheet declaring a field of that spelling is refused whether or not the system declares any creation. Adding a field to a `characterSheet` is safe and removing one is not, which was already true and now has a second reason: a step writing to a key that has gone is an install failure, and a step writing a kind of value the remaining field cannot hold is the same.
- The ledger records against step ids, never indexes, because an install replaces a system in place. A step id is therefore as permanent as an optional rule's id; renaming one drops that step's record from every half-built character the way `effectiveRules` drops a setting for a rule that has gone.
- **What a step applied is its own contribution, not the field's new value.** Two steps writing into one box is normal — Monolith's background and its finishing touches both join into `details` — so the ledger records the lines and the slots a step added rather than what the field now reads. That is what lets a rerun take its own previous contribution back out and leave the other step's alone, which is what makes a reroll replace rather than accumulate. `join` and `stow` are revertible; `set` is not, because nothing records what a field held before it.
- Read both real declarations before writing a third. `../devils-toys-monolith` and `../devils-toys-cairn` each carry one in `system.json` and the reasoning for it in `character-creation-plan.md` beside it — between them they use all nine step kinds and exactly one of `derive`'s five operations. Monolith's background is the standing example of a packet that chooses a section, followed by table steps resolved from that choice; its first table also reads the HP roll from an earlier step.

## Adding a room theme

1. Add the theme id to `THEME_IDS` in `shared/src/index.ts`. The status payload, the room settings menu, request validation, and the database CHECK constraint all read that list.
2. Add a display name to `themeNames` in `client/src/App.tsx` and a `.theme-<id>` custom property block in `client/src/styles.css`. Every theme defines the same nine properties, so a partial block inherits the default palette.
3. Update `client/src/smoke.test.ts` and `changelog.md`.
4. No manual database work is required. Existing databases are migrated on the next start, which `server/src/db-migrations.test.ts` covers.

## Starships

- A system that gives its group a starship declares its hull classes in `starshipSheet.sizes`. A size owns the stats its class fixes — for Monolith the crew range, movement, and mobility — and those are rewritten whenever the size changes.
- `baseValues` holds what every ship of any size starts with, such as Monolith's Starship Scores of 10. They are filled only where the sheet is blank so re-sizing never discards a score a module raised. Choosing a size never puts parts in holds; the crew fills those.
- Hold capacity comes from the chosen size, so no client should restate the size table.
- Installable parts are read from the system's own parts tables by `server/src/starship-parts.ts` and sent with the group definition, the same way random tables are. A part's second column must be its cost, and a part is bulky when the book says so in its parenthetical.
- A bulky part occupies the hold after it, written as a continuation line. Installing one is refused when that hold is taken or does not exist, and replacing it frees the hold it was spilling into.

## The item catalogue

_Cairn, Monolith, and Cities Without Number are named below as worked examples. They were part of this repository until the systems were split out and are now `../devils-toys-cairn`, `-monolith`, and `-cwn`; the behaviour each one illustrates is unchanged._

- A system's gear lives in its own repository's `items.json`. **The catalogue is the authority, not the rulebook.** The book seeds it once and has no say in it afterwards. This is a deliberate exception to the rule below that content is read from the book rather than restated: gear gets fixed, rebalanced, added to, and thrown out, and none of that can survive if the book reseeds it.
- **Seeding is additive and never rewrites.** `systems:catalog` fills a catalogue that has none, and afterwards contributes only ids it has never seen. Nothing a run can do will reorder, rewrite, or reinstate an entry, so a hand edit needs no defending against the build.
- Re-running it folds in what a book has gained since — a corrections file, a new printing. An entry already held keeps every value it has, and an id under `retired` is never offered again. An entry the book no longer offers is reported and left alone, since it is either a deliberate addition or a rename. Run it and read the diff: what appears is what the book gained.
- **Removing an entry means retiring it.** Deleting it from `lists` alone lasts until the next `systems:catalog`, because the book still prices it. Put its id in the catalogue's `retired` array and it stays gone. Monolith's `heavy-weapons` and `stationary-weapons` are the standing example: one priced row each, replaced by the two weapons the row's own description names.
- To rebuild a catalogue from the book from scratch, delete the file and run the command again. That discards every hand edit in it, which is why it is a deletion and not a flag.
- Hand-edit `items.json` freely; that is what it is for. It is `.prettierignore`d so nothing reformats it under you, though a run that adds entries rewrites the whole file in the serializer's format.
- `weaponCategories` on a list is read only while seeding, by `systems:catalog`. There is no correction hook in the system definition — an entry the parser reads wrongly is fixed in the catalogue, which nothing will undo. Monolith's Basilisk Gland is the standing example: the parser reads it as ordinary gear because its damage sits in a second parenthetical, and the catalogue records it as a 1D8 weapon.
- Every item carries an `id` built from the system and the item's name, so anything that needs to point at an item has something stable to point at, and so the seeder can tell a new entry from one already held. Ids are qualified by spec only where a name repeats, so an unrelated table gaining a row cannot move one. `catalogFromRulebook` refuses to produce a duplicate id.
- The file is read off disk beside the system's other content, not through the `GameSystem` definition. The seeder reads that definition to decide what to offer, so a definition carrying its own catalogue could not be loaded until the catalogue already existed. A new system therefore starts with a placeholder `{"system":"<id>","source":"","lists":{}}` before its first `systems:catalog`.
- esbuild inlines the JSON into the server bundle, so the runtime image needs no extra files. Do not switch it to a runtime `fs` read without also adding it to the Dockerfile.
- What a system's weapon words mean lives beside the gear in the same repository's `traits.json`, on the same terms: `npm run systems:catalog -- <dir>` seeds it from the definition lists the system names in `traitCatalog.headings` and folds in what the book has gained since. A trait a book states in prose rather than in a list — Monolith's bulk and blast, Cairn's bulk — is written in by hand and is never touched. The client reads the catalogue from `/api/status` at start-up, so a change needs a server restart to be seen.

## Weapons and carried items

- An item's mechanics live in the parenthetical the book writes beside its name, and `shared/src/character-items.ts` is the one place that reads them. Both the server's catalogue parser and the client's free-text slots go through it, so a weapon is judged the same way whether it came out of a rulebook table or was typed into a slot.
- A weapon is either an entry under a category the system declares in `weaponCategories`, or an item whose parenthetical states damage. The first catches weapons with no die — Monolith's stun gun states a save — and the second catches weapons the book files elsewhere, such as its sledgehammer under Tools. A die that counts uses, charges, rounds, or slots is not damage; the exclusions are covered by tests against the real tables and should stay that way.
- Traits are the remaining comma-separated terms of that parenthetical, kept in the book's own words rather than mapped onto a vocabulary this application invents. Read them from the parenthetical only where the parenthetical is what made the item a weapon: an augment states its socket there, and a socket is not a trait.
- A rulebook entry the reading cannot get right is corrected once, in `items.json`, not left for each player to mark on their own slot. Prefer that to loosening the parser for a single unusual row: the parser runs over two whole books, and the catalogue is where a one-off belongs.
- Slots hold plain strings, and that is deliberate — a sheet is free text a player can overwrite. Anything known about a slot's weapon beyond its text lives in a parallel array under `weaponOverrideKey(listKey)`, holding a `SlotWeaponDetail` per slot. Only what disagrees with the reading is stored, so an ordinary weapon keeps following its own notation.
- The slot's text and its weapon record must be written together. `setListItem` on the character sheet and `setHirelingListItem` on the group page are the only writers; both clear the record when the text changes, because a record keyed by position would otherwise be inherited by whatever was stowed next.

## Random tables

- Tables are read out of each system's authoritative Markdown by `server/src/roll-tables.ts`, never restated in the system package. A Markdown table is rollable when its first column is a die and its rows are keyed by die values, so reference tables such as equipment lists stay out of the catalogue.
- A system package records only what its catalogue is called and which tables to leave out, in `tableCatalog`.
- Tables carry the part of the book they came from as `category`, which is what the roller lists as browsable sections. A document with a single top-level heading is titled by it, as Cairn is, so that heading is dropped; Monolith uses top-level headings for chapters and they become the sections. A table with no heading above it is its own section, as Monolith's one-table GROUP DEBT chapter is.
- Which dice exist is `SUPPORTED_DIE_SIDES` in `shared/src/roll-tables.ts`, and `DIE_SIDES_PATTERN` beside it is that list as a regex alternation. The parser, the heading marker, the CSV importer, the roller, and the custom-table validator all build their patterns from it, so a new die is one line rather than five. Keep it in descending order — a numeral that prefixes a longer one is always the smaller of the two, which is what stops `10` matching before `100`.
- The die comes from the column heading, then from a `(d20)` marker on a heading above the table, and last from the values the rows cover. Where a source and its own die disagree, keep the stated die and report the rows it cannot reach rather than silently changing either one; intentional repairs belong in the system's own `rules/corrections.md`.
- Custom sets live in the `table_sets` table as Markdown and go through the same parser, so a set added outside any system behaves exactly like a system's own.
- A repository export is different from the editable database copy: it contains runtime JSON under `raw/tables/`. Standalone checked-in sets are listed in `raw/tables/repository-sets.json`; the bundled `import-tables.mjs` compares set and table changes and must confirm before writing either the registry or a set file. These catalogues are read-only at runtime and do not require a `GameSystem` package.
- Roll visibility is one choice with four values (`public`, `private`, `invisible`, `reveal`) even though the interface presents three checkboxes. The server decides what each one broadcasts; a client must never be trusted to withhold table text it was sent.

## The Devil's Tables

- The editor is a second application: `tables-client/` served by `server/src/tables-server.ts` on `DEVILS_TABLES_PORT`. It shares the database and the session cookie — which is scoped by host, not port — and holds no rooms, media, or WebSockets. It has to start and run with the game server stopped; anything it needs from `server/src/index.ts` gets extracted into a router both entries mount, as `sessionRouter` and `tableSetRouter` were.
- Markdown in `table_sets` stays the source of truth. The grid is a view onto it, parsed in the browser with the same `parseRollTables` the roller uses, so what is shown is what will be rolled. Never add a second store for table contents.
- An edit is written back with `spliceTable`, which replaces only the lines `RollTable.source` recorded and leaves every other line — prose, notes, other tables — exactly as it was. Re-emitting a whole document to change one row is a bug. `serializeSet` is for documents with no source to preserve: CSV imports and bundles.
- A table's own tags live in a `<!-- tags: … -->` comment above it, so they survive an export and a merge into `raw/`. Set-level tags stay in `table_sets.tags_json`. A table shows both, deduplicated in vocabulary order.
- The tag vocabulary is a database table seeded from `BUILTIN_TABLE_TAGS`, not a fixed union. Seeding is keyed on the slug, so a built-in's slug can never change — it would come back beside its replacement on the next start. Validate tags against the vocabulary on read and write, and refuse an unknown slug rather than dropping it.
- Three gates in `server/src/table-permissions.ts` cover every table route: anyone signed in reads, a GM authors, an admin also re-slugs, merges, and retires tags and produces a repository bundle. Put a new route behind one of them; do not write another role check.
- Round-trip fidelity is the property the editor rests on. `server/src/table-markdown.test.ts` rewrites every table in both rulebooks and re-reads it; keep it passing rather than special-casing the parser.

## Database schema changes

- The schema in `server/src/db.ts` runs on every start with `CREATE TABLE IF NOT EXISTS`, so it never alters a table that already exists. Changes to a table in the field need an explicit migration below the schema block.
- Added columns use the `hasColumn` guard. Changing a constraint needs the rooms-style rebuild: create the replacement table, copy the rows, drop the original, and rename, with `PRAGMA foreign_keys = OFF` set outside the transaction and restored after it. Derive the constraint from the shared source of truth so the migration also recognises the next change.
- Make the migration idempotent and detectable from the stored schema in `sqlite_master`, not from a version counter.

## Server tests that touch the database

- Importing most server modules reaches `db.ts`, which opens a database as a side effect. `server/src/test-setup.ts` redirects every test file to a throwaway data directory so no test can read or migrate the configured one.
- A test that needs a specific starting schema writes its own database with `node:sqlite`, sets `DEVILS_TOYS_DATA_DIR`, then calls `vi.resetModules()` and imports `./db.js` to apply the real schema and migrations. Close each database and remove the directory afterwards; Windows keeps files locked while a handle is open.
- Confirm a migration test fails when the migration is removed. A test that passes against an unmigrated database is not testing the migration.

## Engineering constraints

- Keep mutable files below the configured data directory.
- Treat role checks as server responsibilities.
- Avoid hard limits where the rules call for warnings.
- Keep player workflows phone-ready; keep essential GM actions usable on small screens.

## Drop-down styling

- Style native `select` controls with the same solid `var(--surface)` background, `var(--text)` text, `var(--line)` border, square corners, and Inter type used by adjacent inputs. Give the control an explicit height and horizontal padding rather than relying on browser defaults.
- Apply the same solid background and text colours to `option` elements. Native option panels inherit from the control inconsistently, and transparent backgrounds can expose an operating-system palette that does not match the active room theme.
- Constrain selects in grid or flex layouts with `min-width: 0` and a bounded width so long option labels do not widen their panel. Keep the global `:focus-visible` outline intact.
