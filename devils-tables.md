# Using The Devil's Tables

The Devil's Tables is where the random tables your games roll on are written, tagged, and moved between copies of the application. It shares its database with The Devil's Toys, so a table saved here is on the roller the next time a GM opens it — no restart, no export step.

This page is about using it. Starting it is covered in the project's README.

## What you can do, by account

Sign-in is the same account you use for the game.

|                                          | Admin | GM  | Player |
| ---------------------------------------- | :---: | :-: | :----: |
| Browse sets, tables, and tags            |  ✅   | ✅  |   ✅   |
| Create, edit, duplicate, and delete sets |  ✅   | ✅  |   —    |
| Assign tags; create and rename a tag     |  ✅   | ✅  |   —    |
| Merge, retire, or re-slug a tag          |  ✅   |  —  |   —    |
| Import CSV and bundles                   |  ✅   | ✅  |   —    |
| Export CSV and bundles                   |  ✅   | ✅  |   ✅   |
| Build a repository bundle                |  ✅   |  —  |   —    |

A player sees the catalogue exactly as it is, with no editing controls at all.

## Sets and tables

A **set** is a collection of tables that travel together — one book's worth, one campaign's worth, whatever suits. Each set is a single Markdown document, and the tables inside it are found by the same parser the roller uses. What you see in the editor is what will be rolled.

The catalogues that ship with the application — Cairn, Monolith, Cities Without Number — are read from the rulebooks and are **read only**. To build on one, open it and use **Duplicate**: you get an editable copy of every table in it.

## Adding a table

From **Table sets**, open a set and press **+** beside the table count. A new table arrives with one row and one column, ready to fill in.

Each table has:

- **Name** — the heading it appears under. Renaming it can change the table identifier that **Next roll** links store; the editor automatically retargets every affected link in the set when that happens.
- **Die** — one of d4, d6, d8, d10, d12, d20, d30, d44, d66, or d100. The compound dice (d44, d66) are read as digit pairs, so d44 covers 11–44 using digits 1 to 4.
- **Columns** — one or more result columns. Add and remove them from the header row.
- **Rows** — a die value and a cell per column. A value can be a single number (`7`) or a range (`4-14`).
- **Next roll** — an optional table in this set to roll after that row comes up. The game rolls the linked table automatically and shows the results as one sequence. Different rows can lead to different tables.

Two things make filling a table out quicker:

- **Fill dN** gives the table one row for every value its die can roll, keeping whatever you have already written.
- **Add row** continues from the highest value the table already covers.

The editor tells you when something does not add up: rows reaching past what the die can roll, values the die can roll with no row at all, and rows whose die value it cannot read. None of these stop you saving — a half-written table is a normal thing to have — but a table that covers its die exactly will never come up empty.

**Apply to the set** folds your changes back into the set's Markdown. Nothing is stored until you then press **Save**.

### Writing Markdown directly

The **Markdown** button swaps the grid for the document itself. A table is found when its first column is a die and its rows are keyed by die values, exactly as the rulebooks are written:

```markdown
### Rumours in the market

<!-- tags: fantasy, random-encounter -->

| d6  | Rumour                             | Who says so |
| --- | ---------------------------------- | ----------- |
| 1-3 | The well has gone bitter           | A carter    |
| 4-6 | A stranger asks after the old road | A child     |
```

Anything that is not a table — prose, notes, headings — is left alone. Editing one table in the grid rewrites only that table's lines and never touches the rest of the document.

A literal `|` inside a cell is written `\|`.

The grid stores a next-roll choice as an HTML comment at the end of the row's final cell, such as `<!-- next-table: injuries-d8 -->`. It stays invisible in the result while remaining portable in Markdown exports. Links must point within the same set and cannot form loops.

## Tags

Tags are how a GM finds a table quickly during a game. They come from two places:

- **Set tags** apply to every table in the set. Use these for the broad ones — a whole book is science fiction.
- **Table tags** live in a `<!-- tags: … -->` comment above the table and apply to it alone.

A table carries both. Browsing a set shows every tag present in it with a count of how many tables carry it — `Sci-fi (44)`, `Character Building (40)`, `Random Encounter (1)` — and clicking one narrows the list to those tables. A set-level tag counts the whole set, because that is what it means.

The **Tags** page manages the vocabulary itself. Anyone who can edit may add a tag or change its name. Merging one tag into another, retiring one, or changing its slug rewrites every set that uses it, so those are an admin's to do. The tags the application ships with can be renamed but keep their slugs.

## Importing a CSV

Most tables already exist in a spreadsheet somewhere. From inside a set, choose a CSV file and you are shown what was read before anything is written.

Download **Sample CSV** for a working file to edit. The shape is:

```csv
table,dice,tags,roll,Rumour,Who says so
Rumours in the market,d6,"fantasy, random-encounter",1,The well has gone bitter,A carter
Rumours in the market,,,2,Bread has doubled in price,The baker
Rumours in the market,,,3-4,A stranger has been asking after you,A child
```

- The first four columns must be `table`, `dice`, `tags`, `roll`, in that order.
- Everything after `roll` becomes a result column, named by its heading.
- `table`, `dice`, and `tags` are read from the first row of each table's group and can be left empty on the rows below.
- `dice` may be left out entirely if the values make the die obvious — rows 1 to 6 are a d6.
- `roll` takes a value or a range.
- One file can hold several tables. Start a new one by writing a new name in `table`.

The preview lists what it found and, line by line, what it could not use. Rows it cannot read are skipped rather than guessed at, and the rest still import. Tags naming something this instance does not have are left off, and it says which.

Importing **adds** to the set by default. Tick the replace box to have the file become the whole set instead.

A single table can also be exported as CSV, in the same shape, to edit elsewhere and bring back.

## Moving tables between instances

**Export all custom sets** downloads a `.zip` holding one Markdown file per set plus a manifest naming them and the tags they rely on. Built-in catalogues are not included; they are already in every copy of the application.

**Import a bundle** reads one back. Before anything is written it shows, set by set, whether it is new, already here unchanged, or a name that exists with different tables — and which tags it would create. You then choose per set whether to add it, replace what is here, or skip it. Tags the bundle needs and this instance lacks are created for you.

The Markdown survives the round trip exactly, including table-tag and next-roll comments, so exporting and re-importing a set changes nothing about it. Current imports also accept the older JSON portable-bundle format and turn it back into canonical editable Markdown.

This portable bundle is the instance-to-instance path. CSV moves one or more tables into a chosen editable set and is useful for spreadsheets, but it does not carry prose around the tables or next-roll links. The repository export below is a third format: runtime JSON plus a review-first CLI for changing a checkout, not a bundle to upload into another running instance.

## Contributing a set back to the project

An admin editing a set can download **Repo JSON + importer** for that set, or use **Export for repository** to include every custom set. The archive contains one runtime JSON file per set, a manifest, and a dependency-free `import-tables.mjs` CLI.

Unzip it, open a terminal anywhere inside a checkout of The Devil's Toys, and run the script by its path:

```powershell
node path/to/the-unzipped-bundle/import-tables.mjs
```

The script compares the bundle with `raw/tables`, names the existing sets it would update and the new sets it would add, then lists added, updated, and removed tables inside each changed set. The JSON preserves the table structure directly, including table tags and next-roll links. It asks **Confirm Y/N?** before writing. A refusal changes nothing. A confirmation writes the set JSON and updates `raw/tables/repository-sets.json`; after that, review `git diff`, run the tests, and commit those files normally. Imported repository sets are read-only built-in catalogues after the applications restart.

This is the only export in the editor that changes the application repository rather than moving data between instances, which is why it is an admin's.

## Things worth knowing

- Editing a table normalises that one table's formatting. Every other line of the document is left byte for byte as it was.
- Nothing here sends anything to a game in progress. A GM picks up a new or changed table the next time they open the roller.
- The editor can be stopped and started freely. Games do not depend on it running.
