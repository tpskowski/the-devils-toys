# Project guidance

## Adding new systems

1. Create `systems/<slug>` as a workspace package following the shared `GameSystem` type.
2. Keep system metadata, character fields, constraints, dice behavior, and content classification in that package.
3. Put authoritative source Markdown in `raw/`; preserve its wording exactly except for documented repairs in `raw/corrections.md`.
4. Mark every content section as `player` or `gm`. Server-side search and direct reads must apply that classification before returning data.
5. Register the package in `server/src/systems.ts` and add focused tests for defaults, dice rules, character fields, and access filtering.
6. Do not add runtime installation. Systems are compiled into the application.

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

## Random tables

- Tables are read out of each system's authoritative Markdown by `server/src/roll-tables.ts`, never restated in the system package. A Markdown table is rollable when its first column is a die and its rows are keyed by die values, so reference tables such as equipment lists stay out of the catalogue.
- A system package records only what its catalogue is called and which tables to leave out, in `tableCatalog`.
- Tables carry the part of the book they came from as `category`, which is what the roller lists as browsable sections. A document with a single top-level heading is titled by it, as Cairn is, so that heading is dropped; Monolith uses top-level headings for chapters and they become the sections. A table with no heading above it is its own section, as Monolith's one-table GROUP DEBT chapter is.
- The die comes from the column heading, then from a `(d20)` marker on a heading above the table, and last from the values the rows cover. Where the source and its own die disagree — Monolith writes thirty rows under a `D20` heading — keep the stated die and report the rows it cannot reach rather than silently changing either one.
- Custom sets live in the `table_sets` table as Markdown and go through the same parser, so a set added outside any system behaves exactly like a system's own.
- Roll visibility is one choice with four values (`public`, `private`, `invisible`, `reveal`) even though the interface presents three checkboxes. The server decides what each one broadcasts; a client must never be trusted to withhold table text it was sent.

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
