# Changelog

- Moved each system's gear out of the rulebook and into `systems/<id>/items.json`, which the application loads instead of reparsing Markdown on every start. The book seeds the catalogue once and has no say in it afterwards: `npm run build:items` fills a catalogue that has none and leaves a filled one alone, so gear that has been corrected, rebalanced, invented, or thrown out stays that way. `--merge` folds in what a book has gained since, still without overwriting an entry or reinstating a retired one. Every item has an id that a reformatted rulebook cannot move.
- Added weapons as a thing the application knows about rather than a name in a slot. An item is a weapon when the book files it under a weapons table or when its own parenthetical states damage, so Monolith's stun gun counts without a die and its sledgehammer counts from under Tools. A weapon carries its damage and the traits the book writes beside it, both read from the rulebook rather than restated. Any slot on a character or a hireling can also be marked a weapon by hand and given damage, traits, and free notes, which is how anything the book never priced gets to be one.
- Replaced the encounter tab's roster with a board the GM chooses: a map from the Library, or zones. The rail already lists who is in the fight, so the tab shows where the fight is instead. A map put here is shown to the table whether or not the Maps tab has revealed it, and putting it here reveals nothing elsewhere.
- Added a weapon selector to characters and hirelings alike: a drop-down over the weapons carried within reach, and a dual-wield toggle that draws a second. A bulky weapon takes both hands, so it can be drawn but never paired. It replaces the free-text weapon a hireling sheet used to carry, and a rolled hireling now starts with their weapon stowed in a slot rather than written in a field.
- Added a colour per side to every theme, so a name in the initiative rail and on the encounter board says whose it is at a glance. Each palette states its own pair rather than one pair being imposed on all of them.
- Added zones to an encounter: named places laid out left to right, with every combatant standing in one or waiting below. Players move their own characters and the GM moves anyone, by dragging a round portrait or by picking it up and choosing where it goes.
- Added what a system's weapon words mean as `systems/<id>/traits.json`, seeded from each book's own definition lists and hand-written where a book explains a word in prose. A weapon's traits now carry their definitions wherever they are shown — beside a slot, in the combat rail, and in the log line of a roll — instead of repeating the word back.
- Added a range to every weapon, read from the notation each system uses: `Melee`, the book's own words for a distance, or `unknown` where a book states none. A slot can record one by hand where its book never did.
- Added shared, player-editable Freelancer sheets for Monolith and Hireling sheets for Cairn on the Group tab, including a disabled placeholder for future level-up support.

## 0.1.0 — In development

- Added an optional shared room calendar with custom years, months, weeks, day segments, holidays, recurring events, and GM time advancement.
- Fixed calendar advancement by giving GMs an explicit segments-per-day setting; one advances whole days, while larger values advance one segment per click.
- Added calendar month/year browsing, theme-aware past and partial-day shading, and chat announcements whenever the GM advances time.
- Added once-per-room easter eggs when the GM first enables the calendar or map notation.
- Added optional persistent map notation with shared drawing, labels, shapes, colors, erasing, undo, and GM clearing tools.
- Moved online and offline presence into the Group party roster and removed the duplicate People panel from the chat rail.
- Moved Rules into the main table tabs with a persistent heading index while retaining the external reference pop-out.
- Added a Monolith character-sheet Vices section with rulebook-backed selection, random selection, and editable custom vices.
- Established the TypeScript workspace and single-process application architecture.
- Added local setup, authentication, rooms, chat, dice, live presence, and five room themes.
- Added Cities Without Number as the third compiled-in system, with its character sheet, roll-over saves, 2d6 skill checks, rules, antagonist catalog, and random tables.
- Added system-configurable Group tabs with shared room data, Cairn and Monolith hireling placeholders, Monolith group debt, and a responsive starship sheet.
- Added Monolith hull classes to the starship sheet: choosing a size sets its crew, movement, mobility, holds, and starting Starship Scores.
- Added a per-hold part picker offering the book's own starship parts, with bulky parts claiming the hold after them.
- Added roll visibility to the dice roller: anyone can roll privately, which tells the table a roll happened and shows the result to the roller and the GM, and the GM can roll invisibly, which tells the table nothing.
- Added a GM random-table roller: every Cairn, Monolith, and Cities Without Number table read from the system books, type-ahead table selection, a switcher between systems and custom Markdown table sets, and public, private, invisible, or revealed rolls.
- Added controlled tags for random tables, with fantasy, sci-fi, character-building, random-encounter, and gear filters; every Cairn table is tagged fantasy, every Monolith table is tagged sci-fi, and editable custom-set tags apply to each table in that set.
- Added The Devil's Tables, a second application for writing and curating random tables. It runs on its own port against the same database, starts with or without the game server, and signs in with the same account.
- Added a link to The Devil's Tables in the game's left rail beneath the room list, for admins and GMs. The game checks whether the editor is answering: when it is not, the row says so and offers the command that starts it rather than opening a link that fails. It finds the editor on this host by default, and takes an explicit address for deployments that move it.
- Added a table editor with a grid for rows, columns, and dice, live warnings about values the die cannot reach or does not cover, per-table tags, and a raw Markdown view. An edit rewrites only the table it changed, leaving the rest of the document untouched.
- Added an editable tag vocabulary: tags can be created and renamed by a GM, and merged or retired by an admin, which rewrites every set that uses them. The tags that ship are seeded rather than fixed, so a tag added to the application later appears in its declared place without disturbing one an instance renamed or added itself.
- Added cyberpunk, real-world, world-building, names, and loot to the tags that ship.
- Added CSV import with a downloadable sample, previewed before anything is written, and CSV export of a single table.
- Added zip bundles: an export that carries sets and their tags into another copy of the application, an import that says what it will do before it does it, and a bundle shaped for folding a set into this repository with instructions written against the real paths.
- Fixed random tables written with a literal pipe inside a cell, which Monolith's injury tables use; they were being read as an extra column.
