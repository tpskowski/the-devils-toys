# Project guidance

## Adding new systems

1. Create `systems/<slug>` as a workspace package following the shared `GameSystem` type.
2. Keep system metadata, character fields, constraints, dice behavior, and content classification in that package.
3. Put authoritative source Markdown in `raw/`; preserve its wording exactly except for documented repairs in `raw/corrections.md`.
4. Mark every content section as `player` or `gm`. Server-side search and direct reads must apply that classification before returning data.
5. Register the package in `server/src/systems.ts` and add focused tests for defaults, dice rules, character fields, and access filtering.
6. Add `systems/<slug>/items.json` containing `{"system":"<slug>","source":"","lists":{}}` and `systems/<slug>/traits.json` containing `{"system":"<slug>","source":"","traits":[]}`, then run `npm run build:items` and `npm run build:traits` to fill them. The placeholders are needed first because the generators load the system definition. Both commands are one-offs: they seed an empty catalogue and never touch a filled one. See "The item catalogue".
7. Do not add runtime installation. Systems are compiled into the application.

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

- A system's gear lives in `systems/<id>/items.json`. **The catalogue is the authority, not the rulebook.** The book seeds it once and has no say in it afterwards. This is a deliberate exception to the rule below that content is read from the book rather than restated: gear gets fixed, rebalanced, added to, and thrown out, and none of that can survive if the book reseeds it.
- **`npm run build:items` is a one-off per system.** It seeds a catalogue that has none and then refuses to touch it again, reporting `already seeded — untouched`. Nothing a run can do will reorder, rewrite, or reinstate an entry, so a hand edit needs no defending against the build.
- `npm run build:items:merge` folds in what a book has gained since — a corrections file, a new printing — and can be narrowed to one system by running it in the server workspace: `npm run build:items --workspace @devils-toys/server -- --merge cwn`. That pass is **additive only**: an entry already held keeps every value it has, a field it has never carried is filled from the book, and an id under `retired` is never offered again. An entry the book no longer offers is reported and left alone, since it is either a deliberate addition or a rename.
- **Removing an entry means retiring it.** Deleting it from `lists` alone lasts until the next `--merge`, because the book still prices it. Put its id in the catalogue's `retired` array and it stays gone. Monolith's `heavy-weapons` and `stationary-weapons` are the standing example: one priced row each, replaced by the two weapons the row's own description names.
- To rebuild a catalogue from the book from scratch, delete the file and run the command again. That discards every hand edit in it, which is why it is a deletion and not a flag.
- Hand-edit `items.json` freely; that is what it is for. It is `.prettierignore`d so nothing reformats it under you, though a run that adds entries rewrites the whole file in the serializer's format.
- `weaponCategories` on a list is read only while seeding. There is no correction hook in the system definition — an entry the parser reads wrongly is fixed in the catalogue, which nothing will undo. Monolith's Basilisk Gland is the standing example: the parser reads it as ordinary gear because its damage sits in a second parenthetical, and the catalogue records it as a 1D8 weapon.
- Every item carries an `id` built from the system and the item's name, so anything that needs to point at an item has something stable to point at, and so the seeder can tell a new entry from one already held. Ids are qualified by spec only where a name repeats, so an unrelated table gaining a row cannot move one. `catalogFromRulebook` refuses to produce a duplicate id.
- The file is reached as `@devils-toys/system-<id>/items`, not through the `GameSystem` definition. The seeder reads those definitions to decide what to offer, so a definition that carried its own catalogue could not be loaded until the catalogue already existed. Adding a system therefore starts with a placeholder `{"system":"<id>","source":"","lists":{}}` before the first `npm run build:items`.
- esbuild inlines the JSON into the server bundle, so the runtime image needs no extra files. Do not switch it to a runtime `fs` read without also adding it to the Dockerfile.
- What a system's weapon words mean lives beside the gear in `systems/<id>/traits.json`, on the same terms: `npm run build:traits` seeds it from the definition lists the system names in `traitCatalog.headings`, once, and `npm run build:traits:merge` folds in later additions. A trait a book states in prose rather than in a list — Monolith's bulk and blast, Cairn's bulk — is written in by hand and is never touched. The client reads the catalogue from `/api/status` at start-up, so a change needs a server restart to be seen.

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
- The die comes from the column heading, then from a `(d20)` marker on a heading above the table, and last from the values the rows cover. Where the source and its own die disagree — Monolith writes thirty rows under a `D20` heading — keep the stated die and report the rows it cannot reach rather than silently changing either one.
- Custom sets live in the `table_sets` table as Markdown and go through the same parser, so a set added outside any system behaves exactly like a system's own.
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
