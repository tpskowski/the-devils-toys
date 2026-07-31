# Migrating table data from Markdown to JSON

## Decisions this plan is built on

1. **Scope: the rollable catalogue only.** The 130 tables `parseRollTables` finds become JSON. The ~33 priced
   gear/cyberware/starship-parts tables that `server/src/rules-tables.ts` reads with `readPricedRows` keep their
   Markdown reader and stay embedded in the rules. `character-items.ts` and `starship-parts.ts` are not touched.
2. **Custom sets move too.** `table_sets` stores JSON, and The Devil's Tables edits JSON. One active storage format
   everywhere; `spliceTable` retires from the write path. The migration keeps the original Markdown in an inert
   `migration_markdown` backup column so a formatting regression is recoverable without making Markdown a second
   runtime store.
3. **`raw/*.md` is never edited.** The rules route strips each migrated table at serve time and injects a link,
   using the line range the JSON records. The SRD sources stay byte-identical, the conversion stays re-runnable,
   and the database migration is reversible with an explicit reverse migration that restores
   `migration_markdown`. Reverting code alone is not a database rollback.

## Inventory

| Source                              | Rollable tables | Rows  | Pipe tables total | Non-rollable (left alone) |
| ----------------------------------- | --------------- | ----- | ----------------- | ------------------------- |
| `raw/Cairn.md`                      | 11              | 211   | 16                | 5                         |
| `raw/Monolith.md`                   | 75              | 783   | 102               | 27                        |
| `raw/CitiesWithoutNumberSRDv1.0.md` | 44              | 314   | 45                | 1                         |
| **Total**                           | **130**         | 1,308 | 163               | 33                        |

`raw/Worlds_Without_Number_SRD.md` has no pipe tables and is not wired to a system package. Ignore it.

## A correction to the brief, before anything else

**Do not have a model transcribe table rows.** The conversion is fully mechanical — `parseRollTables` already
produces exactly the object graph the JSON needs. A script does the extraction; the second model's job is the
surrounding code changes (routes, readers, editor, modal) and running the script. Every row a model retypes is a
row that can be silently paraphrased, and 1,308 rows is far past the point where review catches that.

The test suite below is therefore written to verify a _script's_ output, and to fail loudly if anyone hand-edits
the JSON afterwards.

---

## Target shape

### Files

```
raw/tables/cairn.json
raw/tables/monolith.json
raw/tables/cwn.json
raw/tables/manifest.json        # golden baseline, generated in Phase 0, never regenerated in place
```

Add to `Dockerfile` beside line 27:

```dockerfile
COPY --from=build /app/raw/tables/*.json ./raw/tables/
```

Declare the file on the system package's source document, in `shared/src/index.ts` `SystemSourceDocument`:

```ts
/** The extracted rollable tables for this document, under `raw/tables/`. */
tablesFile: string;
```

### Set document schema (`formatVersion: 1`)

```jsonc
{
  "formatVersion": 1,
  "setName": "Monolith tables",
  "sourceDocument": "Monolith.md", // omitted for custom sets
  "preamble": "", // custom sets only: prose above the first table
  "postamble": "", // custom sets only: prose after the last table
  "tables": [
    {
      "id": "backgrounds-soldier",
      "name": "BACKGROUNDS — Soldier",
      "section": "BACKGROUNDS",
      "category": "BACKGROUNDS",
      "dice": "d20",
      "columns": ["Result"],
      "tags": ["character-building"],
      "rows": [{ "label": "1", "min": 1, "max": 1, "cells": ["…"] }],
      "classification": "player", // raw/-derived tables only: player or gm
      "notesBefore": "", // custom sets only: prose between the previous table and this one
      "origin": {
        // raw/-derived tables only
        "markdownFile": "Monolith.md",
        "headingPath": ["BACKGROUNDS", "Soldier"],
        "headingLine": 410,
        "tagsLine": 411,
        "tableStart": 412,
        "tableEnd": 432
      }
    }
  ]
}
```

`id`, `name`, `section`, `category`, `dice`, `columns`, `tags`, and `rows` must be structurally identical to what
`parseRollTables` produces today. That identity is the linking guarantee; the tests in Phase 0 enforce it.
`classification` and `origin` are generated metadata outside that comparison.

`origin` replaces `RollTableSource` for repository tables and exists for exactly one purpose: telling the rules
route which lines to strip. Custom sets carry no `origin` — nothing splices them any more.

`preamble`, `notesBefore`, and `postamble` preserve all non-table text before, between, and after custom tables.
The semantic table data is lossless, but JSON does not retain arbitrary pipe spacing, heading levels, or blank-line
style inside a table. Do not claim that JSON → Markdown reproduces the original document byte for byte. Instead,
the migration keeps the exact original in `migration_markdown`; it is an audit/rollback copy that no runtime reader
or editor writes after migration. A future cleanup may remove it only after real migrated databases have been
verified.

Repository-table `classification` is derived mechanically from the owning system's `contentModules` and
`gmOnlyHeadings`, using `origin.headingPath`. The default is never inferred by the client. A table under a GM-only
root is `gm`; everything else is `player`. The converter and verifier fail if the two metadata sources disagree.

### Database

One migration in `server/src/db.ts`, below the schema block, rooms-style rebuild:

- new `table_sets` with `tables_json TEXT NOT NULL` in place of active `markdown TEXT NOT NULL`, plus nullable
  `migration_markdown TEXT` holding the exact pre-migration document
- copy rows, converting each `markdown` through the same converter the script uses and copying the original bytes
  to `migration_markdown`
- `PRAGMA foreign_keys = OFF` outside the transaction, restored after
- idempotent and detectable from `sqlite_master`: rebuild when `markdown` is present or `tables_json` is absent;
  a table with `tables_json` and no `markdown` is already migrated

Confirm the migration test fails when the migration is removed.

---

## Phase 0 — Freeze the baseline (do this before touching anything)

This is the phase that makes the rest verifiable. It runs against `main` as it stands today.

1. Add `tsx` as an explicit root dev dependency and write `scripts/tables-manifest.ts`. The shared package exports
   TypeScript with build-time `.js` specifiers, so these tools must not rely on plain Node importing
   `@devils-toys/shared`. Import the TypeScript source through `tsx`. For every system the script parses
   `raw/<markdownFile>` with the **current**
   `parseRollTables` and emits `raw/tables/manifest.json`:

   ```jsonc
   {
     "_comment": "Pre-migration baseline. Never rewrite existing entries.",
     "generatedAt": "2026-07-31T…",
     "sets": {
       "system:monolith": {
         "tableCount": 75,
         "tables": [
           {
             "id": "backgrounds-soldier",
             "dice": "d20",
             "rowCount": 20,
             "columnCount": 1,
             "unreachableRows": 0,
             "digest": "<sha256 of canonical JSON of {id,name,section,category,dice,columns,tags,rows}>"
           }
         ]
       }
     }
   }
   ```

2. Commit `raw/tables/manifest.json` on its own, before any conversion.

3. **The manifest is never regenerated.** It is the record of what the data was before a model touched it. If a
   later commit changes it, that change is the thing to review — not the JSON.

Expected totals to sanity-check the manifest against: `system:cairn` 11 tables, `system:monolith` 75,
`system:cwn` 44.

---

## Phase 1 — Converter and JSON, read by nothing

### `scripts/tables-md-to-json.ts`

Three modes, all of which stay useful for every future `md → json` conversion:

```bash
# convert
npx tsx scripts/tables-md-to-json.ts --in raw/Monolith.md --out raw/tables/monolith.json \
  --set-name "Monolith tables" --exclude ""

# drift check: re-parse the Markdown, diff against the committed JSON, exit 1 on any difference
npx tsx scripts/tables-md-to-json.ts --check --in raw/Monolith.md --out raw/tables/monolith.json

# every system at once, using systems/*/src/index.ts for names and excludes
npx tsx scripts/tables-md-to-json.ts --all
npx tsx scripts/tables-md-to-json.ts --all --check
```

The converter is a thin wrapper: `parseRollTables(markdown, exclude)` → rename `source` to `origin` (adding
`headingPath` and `markdownFile`) → derive `classification` from system content metadata → stable key order →
write with `JSON.stringify(value, null, 2)` and a trailing newline. It contains no per-table knowledge and no
special cases. If a table needs a special case, the parser or system classification is wrong and gets fixed at
that source, not here.

Add `"tables:check": "tsx scripts/tables-md-to-json.ts --all --check"` to the root `package.json` scripts and
into CI.

### `scripts/tables-json-verify.ts`

Runs the semantic invariants (below) against any `{markdown, json}` pair. Usable on a future SRD import with no
changes.

### Deliverable

`raw/tables/{cairn,monolith,cwn}.json` committed. No production code reads them yet. `npm test` and
`npm run smoke` still pass untouched.

---

## Phase 2 — Flip the readers

Nothing about the parse changes; the input does.

| File                                           | Change                                                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `server/src/table-json.ts` _(new)_             | `readSetJson(file)`, `tablesForSystem(id)` reading and validating `raw/tables/<file>`, cached at first use     |
| `server/src/table-sets.ts:39-48`               | `tablesForSystem` reads JSON, then merges `tableCatalog.tags` through the live tag vocabulary exactly as today |
| `server/src/table-sets.ts:150-163`             | Keep the system-set GET response compatible with the current editor during this phase                          |
| `server/src/table-tags.ts:85`                  | tag usage counts read JSON                                                                                     |
| `server/src/roll-tables.ts:29`                 | `parseCompactRollTables(markdown, section)` → `compactTables(systemId, section)` reading JSON                  |
| `server/src/hireling-creation.ts:24`           | follows the signature change                                                                                   |
| `server/src/character-vices.ts`                | finds the vice table in JSON (`columns[0] === "Vice"`), not by re-parsing Markdown                             |
| `server/src/group.ts:189`, `characters.ts:196` | pass the system id rather than `systemMarkdown(...)`                                                           |

`systemMarkdown` stays — the rules reference and `readPricedRows` still need it.

The committed JSON carries only tags produced by `parseRollTables`; inherited system tags are runtime metadata.
Do not bake `fantasy`, `scifi`, or another `tableCatalog.tags` value into every JSON table. `tablesForSystem`
continues to merge and vocabulary-filter inherited and per-table tags, so the current catalogue and smoke-test
behaviour does not change.

Do not change the system-set editor response to `{tables}` until Phase 3 changes `SetEditor` in the same commit.
Returning `{markdown}` temporarily is acceptable because this endpoint is an editor view, not a roller reader.

`shared/src/roll-tables.ts` `parseRollTables` stays exactly as it is. It is now an _import_ tool (used by the
converter, CSV import, and bundle import) rather than a runtime path. Do not weaken it; the Phase 0 manifest and
the Phase 1 `--check` mode both depend on it continuing to behave identically.

---

## Phase 3 — Database and editor

1. **Migration** as described under "Database" above, converting each row's `markdown` through
   `parseRollTables` plus prose capture into `preamble`/`notesBefore`/`postamble`, and retaining the original in
   `migration_markdown`.
2. `server/src/table-sets.ts` — `TableSetRow.markdown` becomes `tables_json`; `setBody` accepts a tables array
   instead of a markdown string. Change the system-set GET response and `SetEditor` together in this phase.
   Validate with the shared schema and semantic normalizer described below, not with shape-only zod validation.
3. `server/src/table-editor.ts` — CSV import builds tables directly instead of going through
   `serializeSet`/`appendTable`. Bundle export writes `sets/<slug>.json` and bumps `BUNDLE_VERSION` to 2;
   `readBundle` still accepts a version-1 `.md` bundle and converts on import, so existing bundles keep working.
4. `tables-client/src/SetEditor.tsx` — edits the tables array directly. `spliceTable`, `appendTable`, and
   `serializeSet` come out of the edit path.
5. `shared/src/table-markdown.ts` — keep `serializeSet` and `tableLines` (the repo bundle and the Markdown export
   still need them). `spliceTable` may be deleted once nothing calls it; `RollTableSource` stays as the parser's
   output type feeding `origin`.
6. `server/src/table-markdown.test.ts` — its round-trip property still matters, but now as _import_ fidelity:
   parse both rulebooks, serialize, re-parse, assert equality. Keep it passing.

### Shared validation and ID allocation

Add one shared `normalizeTableSet`/`validateTableSet` path used by the DB migration, HTTP writes, CSV import, and
bundle import. Shape validation alone is not sufficient because the JSON contains values the parser used to
derive. The normalizer:

- preserves every non-empty existing table id on ordinary edits;
- assigns a slug-based id to a new table whose id is empty, adding `-2`, `-3`, and so on within the set;
- rejects duplicate or malformed non-empty ids rather than silently relinking a table;
- parses each row label and derives `min`/`max`, rejecting a supplied range that disagrees;
- validates supported dice, non-empty/unique columns where required, row ordering and overlap, and pads or rejects
  short cell arrays according to the editor's existing behaviour;
- validates table and set tags against the live vocabulary on server writes; and
- rejects `origin` or `classification` on custom-set writes, since clients never author repository provenance.

This is required before removing the Markdown reparse. `blankTable` and `tablesFromCsv` both produce `id: ""`
today; without this allocator, the first direct JSON save or CSV import would create duplicate empty ids.

A tag re-slug (`rewriteSlug`, `table-tags.ts:101`) only ever touched `table_sets`, and still does. Tags on
repository tables live in `raw/tables/*.json` and are repo data, not runtime data — nothing writes them at
runtime, which is consistent with keeping mutable files below the data directory.

---

## Phase 4 — Rules link and modal

### Server

`server/src/rules-substitution.ts` _(new)_:

```ts
/** Replaces each catalogued table in a rulebook with a link the reader opens as a roller. */
export function substituteTableLinks(markdown: string, setId: string, tables: readonly RollTable[]): string;
```

For each table with an `origin`, working **bottom-up** so earlier line numbers stay valid, splice
`origin.tableStart..origin.tableEnd` (and `origin.tagsLine`, when set) down to one line:

```markdown
[Soldier (d20)](devils-table:system%3Amonolith/backgrounds-soldier)
```

Link text is `rollTableLabel(table.name, table.dice)`, so the die is not repeated when the heading already carries
it. The href is `devils-table:${encodeURIComponent(setId)}/${encodeURIComponent(table.id)}`.

Line numbers are safe only against the original raw document. Before changing anything, the substitution helper
checks for all expected links and returns unchanged when they are already present. If some but not all are present,
or if an origin range no longer parses to the expected table, it throws instead of splicing unrelated lines. This
makes a full second pass a no-op and turns stale or partially substituted input into a visible failure.

Wire it into `server/src/systems.ts`:

```ts
export function rulesMarkdown(system: SystemId, role: "gm" | "player") {
  const linked = substituteTableLinks(systemMarkdown(system), `system:${system}`, tablesForSystem(system));
  return role === "gm" ? linked : filterPlayerRules(linked, systems[system].gmOnlyHeadings);
}
```

**Substitution runs before filtering.** `origin` line numbers refer to the unfiltered document, so doing it the
other way round splices the wrong lines. Filtering afterwards removes placeholders under GM-only headings along
with everything else in those blocks, which is the behaviour you want — a player never receives a link to a
table they cannot see.

**New route** — `GET /api/rooms/:roomId/rules-tables/:setId/:tableId`. This is a classified rules read, not a
general catalogue route. The server:

1. requires membership and reads the membership role and room system;
2. requires `setId === system:<room-system>` — custom sets and another system are refused;
3. resolves the table from that system's JSON;
4. refuses a `gm`-classified table to a player even if the caller knows its id; and
5. returns the table without `origin` or `classification` and grants no roll capability.

The existing table read route (`server/src/tables.ts:138`) remains GM-only. Filtering a link out of rendered
Markdown is defense in depth, never the authorization check.

### Client

- `client/src/TableRollModal.tsx` _(new)_ — extract the roll panel currently inline in
  `TablesModal.tsx:500-560`: the table grid, and the visibility buttons (Roll / Private / Invisible for GMs /
  Reveal). `TablesModal` renders it too, so there is one component and one roll UI.
- `client/src/RulesMarkdown.tsx` — the `a` component override already special-cases `#` hrefs; add a
  `devils-table:` branch that renders a button opening `TableRollModal`. React Markdown 10 strips unknown schemes
  with its default URL transform, so also provide a narrow `urlTransform`: return a value unchanged only when it
  matches the exact generated `devils-table:<encoded-set>/<encoded-table>` form, and pass every other value through
  `defaultUrlTransform`. Never use a pass-through transform for arbitrary URLs. `RulesMarkdown` gains an optional
  `roomId`/`isGm` pair; where they are absent (project docs, media references, NPC reference) the link renders as
  plain text.
- Players get the table read-only, GMs get the roll buttons.

---

## Test plan (requirement 1)

Four layers. The point of the design is that **the model doing the conversion cannot make these pass by
rewriting them**, because the baseline they compare against was committed in Phase 0.

### 1. Equivalence — `server/src/table-json.equivalence.test.ts`

For each system, `parseRollTables(systemMarkdown(id), exclude)` deep-equals the committed JSON, modulo the
`source` → `origin` transform and the added `classification`. This is the acceptance gate for the conversion and
stays useful forever: it is what catches drift the day someone edits `raw/Monolith.md`.

### 2. Semantic invariants — `server/src/table-json.invariants.test.ts`

Checks that hold regardless of whether the parser is right, so a parser bug cannot be laundered into JSON:

- **Every cell appears verbatim in its source lines.** Re-read the physical rows in
  `origin.tableStart + 2..origin.tableEnd` with `cells()`. For a normal table, compare those already-unescaped
  values directly with `[row.label, ...row.cells]`; do not apply `escapeCell`, because `cells()` has already turned
  `\|` back into `|`. For a compact repeated Roll/Result table, expand every physical row into its logical pairs,
  apply the parser's compact-row ordering, and compare that sequence with the JSON rows. This is the single most
  important test in the suite — it catches paraphrasing, punctuation normalization, dropped rows, and invented
  rows without failing Monolith's legitimate compact and escaped-pipe tables.
- Table ids are unique within a set.
- `min <= max` on every row; ranges do not overlap within a table; rows are in ascending order.
- `dice` parses as `\d*d(100|66|44|30|20|12|10|8|6|4)`.
- No row has fewer cells than the table has columns.
- `unreachableRows(table)` matches the manifest, including any explicitly documented source correction.

### 3. Golden manifest — `server/src/table-json.manifest.test.ts`

Every table's `{id, dice, rowCount, columnCount, unreachableRows, digest}` matches `raw/tables/manifest.json`,
and the id sets match exactly in both directions — no table gained, none lost, none renamed.

Put a top-level `_comment` string in the manifest saying it is a pre-migration baseline and regenerating existing
entries defeats its purpose. Do not use JSON comments; the file must remain valid for `JSON.parse`.

### 4. Round-trip — extends `server/src/table-markdown.test.ts`

- JSON → `serializeSet` → `parseRollTables` → JSON is stable for all three systems.
- **Custom-set content losslessness:** for a fixture set with prose before, between, and after its tables, assert
  exact `preamble`, every `notesBefore`, and `postamble`, plus semantic equality for every parsed table. Assert
  separately that `migration_markdown` is byte-identical to the original. A canonical JSON → Markdown export need
  not reproduce incidental table spacing or heading layout byte for byte.
- **Direct JSON normalization:** new editor and CSV tables receive distinct non-empty ids; existing ids survive a
  rename; duplicate ids, inconsistent `label`/`min`/`max`, invalid dice, unknown tags, and client-supplied origin
  metadata are refused.

### Phase 4 tests

- `server/src/rules-substitution.test.ts` — a substituted document contains no pipe table that the catalogue
  claims, contains one `devils-table:` link per catalogued table, and leaves the 33 non-rollable priced tables
  intact (assert `readPricedRows` returns identical rows before and after substitution).
- Substitution is idempotent, and running it on an already-substituted document is a no-op.
- A partially substituted or source-drifted document is rejected rather than spliced at stale line numbers.
- `filterPlayerRules(substituted, gmOnlyHeadings)` contains no `devils-table:` link to a table under a GM-only
  heading.
- The rules-table route refuses non-members, another system, custom sets, and GM-classified tables requested by a
  player; it permits a player-classified table from the room's system.
- `RulesMarkdown` preserves only a well-formed `devils-table:` href through its URL transform and still strips an
  arbitrary unknown or scriptable scheme.
- **Every `rulesQuery` still resolves.** `findRuleExcerpt` / `findRuleAnchorId` search section _text_, so a query
  whose match currently lives inside a table's rows will stop matching once those rows are a link. Assert every
  `rollRulesQuery`, `hirelings.rulesQuery`, and field-level `rulesQuery` declared across `systems/*` returns a
  non-empty excerpt against the substituted markdown. Cairn's `"Saves"`, Monolith's `"Group Debt"` and
  `"Freelancers & Mercs"` are the ones to watch.

### Acceptance

```bash
npm run typecheck && npm test && npm run tables:check && npm run build && npm run smoke
```

---

## Preserving linking (requirement 3)

A checklist to verify explicitly, because "it still works" is not observable from the JSON alone:

- **Table ids** — used in `GET /rooms/:roomId/tables/:setId/:tableId` and the CSV export route
  (`table-editor.ts:41`). Repository ids are identical by construction and enforced by the manifest test. Custom
  ids are preserved on edits and allocated once for new/imported tables by the shared normalizer.
- **Set ids** — `system:cairn`, `custom:12`. Unchanged.
- **Tags** — per-table `<!-- tags: … -->` comments in `raw/` carry into JSON `tags`. The substitution must strip
  the comment line as well as the table, or a stray comment is left behind in the rules.
- **Rules anchors** — `rulesAnchorPath` / `headingSlug` target headings, and headings stay in `raw/`. Insert the
  placeholder _below_ the owning heading so anchors still land in the right place.
- **`rulesQuery` lookups** — covered by the Phase 4 test above.
- **Full-text rules search** — `filterRules` will no longer find text that lived inside a table. The placeholder
  carries the table's name, so searching for the table still finds its section, but searching for a phrase from
  one of its rows will not. This is a real behaviour change; the mitigation, if it matters, is extending the
  search to the catalogue, which is out of scope here.

---

## Reusable tooling and AGENTS.md (requirement 4)

`scripts/tables-md-to-json.ts` and `scripts/tables-json-verify.ts` are written to be system-agnostic from the
start: a future WWN or OSE SRD import is `--in raw/NewBook.md --out raw/tables/newbook.json`, then
`tables-json-verify`, then a manifest entry. No per-book code.

Replace the **Random tables** section of `AGENTS.md` with this, and amend the two rules the migration overturns
(`raw/` is still preserved exactly — that rule is now _more_ true, not less — but "Markdown in `table_sets` stays
the source of truth" and "Never add a second store for table contents" both invert for active data; the inert
`migration_markdown` rollback copy is the temporary, documented exception):

```markdown
## Random tables

- Table data lives in JSON: `raw/tables/<system>.json` for the books, `table_sets.tables_json` for custom sets.
  The roller, the editor, and the rules all read that one store. A system package records only what its
  catalogue is called and which tables to leave out, in `tableCatalog`. System catalogue tags are merged at read
  time through the live vocabulary; they are not duplicated into every generated table.
- A migrated custom set keeps its old document in `table_sets.migration_markdown` for rollback only. Runtime code
  never reads or updates that column. JSON preserves prose before, between, and after tables, while Markdown
  exports use canonical table formatting.
- The JSON is generated from the authoritative Markdown in `raw/`, never hand-edited. Regenerate with
  `npx tsx scripts/tables-md-to-json.ts --all`; `npm run tables:check` fails when the two have drifted, and runs
  in CI.
- `raw/*.md` stays byte-identical to its source. A rulebook's tables are removed at serve time by
  `substituteTableLinks`, which replaces each one with a `devils-table:` link the reader opens as a roller.
  Substitution runs before `filterPlayerRules`, because `origin` line numbers refer to the unfiltered document.
- `parseRollTables` is now an import tool, not a runtime path: the converter, CSV import, and bundle import use
  it. It stays exactly as forgiving as it was, because `raw/tables/manifest.json` — the pre-migration record of
  every table's id, die, row count, and digest — is checked against its output. Never rewrite existing manifest
  entries; a future system appends new ones.
- New and imported JSON tables go through the shared server-side normalizer. It allocates a unique id once,
  derives row ranges from labels, validates dice/cells/tags, and refuses client-authored repository provenance.
- Repository tables are classified `player` or `gm` from their owning source section. Every direct read enforces
  that classification on the server; hiding a link in rendered Markdown is not authorization.
- Reference tables stay in Markdown. A Markdown table is rollable when its first column is a die and its rows are
  keyed by die values, which is what keeps equipment and price lists out of the catalogue; those are read
  separately by `readPricedRows`.
- Tables carry the part of the book they came from as `category`, which is what the roller lists as browsable
  sections. The die comes from the column heading, then from a `(d20)` marker on a heading above the table, and
  last from the values the rows cover. Where the source and its own die disagree, keep the stated die and report
  the rows it cannot reach unless a deliberate repair is recorded in `raw/corrections.md`.
- Roll visibility is one choice with four values (`public`, `private`, `invisible`, `reveal`) even though the
  interface presents three checkboxes. The server decides what each one broadcasts; a client must never be
  trusted to withhold table text it was sent.

## Converting a Markdown book's tables to JSON

1. Add the source to `raw/`, register the system, and give its `sourceDocuments` entry a `tablesFile`.
2. `npx tsx scripts/tables-md-to-json.ts --in raw/<Book>.md --out raw/tables/<slug>.json --set-name "<Label>"`.
3. `npx tsx scripts/tables-json-verify.ts --in raw/<Book>.md --json raw/tables/<slug>.json` — every cell must
   appear verbatim in its source lines, ranges must not overlap, and ids must be unique.
4. Append the new set to `raw/tables/manifest.json`. Add entries; never rewrite existing ones.
5. `npm run tables:check && npm test`.

Never transcribe rows by hand or with a model. The converter is the only supported path, and the verifier exists
because a transcription that looks right is the failure mode worth spending a test on.
```

Also update: `devils-tables.md` ("Each set is a single Markdown document" is no longer true), `changelog.md`,
`README.md` where it describes table storage, and `NOTICE.md` if it describes how SRD text is stored.

---

## Risks and known changes

| Risk                                                       | Handling                                                                                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Prose in a custom set is lost on migration                 | `preamble` / `notesBefore` / `postamble`, semantic migration tests, and exact `migration_markdown` rollback copy                 |
| Custom Markdown formatting changes on JSON export          | Accepted canonicalization; the exact pre-migration document remains in `migration_markdown` until field verification is complete |
| A model hand-edits JSON and "fixes" a typo in an SRD table | Verbatim-cell invariant + `tables:check` in CI                                                                                   |
| `origin` line numbers go stale if `raw/` is edited         | `tables:check` fails on any drift; it is the same check that regenerates                                                         |
| Rules search stops finding text inside tables              | Accepted behaviour change, documented above                                                                                      |
| Player follows a rules table link and gets a 403           | New classified `rules-tables` route allows only a player-visible table from that room's system                                   |
| Player guesses a GM table id                               | Server checks membership, room system, and JSON classification; link filtering is not authorization                              |
| Custom `devils-table:` link is stripped                    | Narrow React Markdown `urlTransform`, with tests that other unknown/scriptable schemes remain blocked                            |
| New/CSV tables share an empty id                           | Shared server-side normalizer allocates unique ids and validates all direct JSON writes                                          |
| Bundle compatibility                                       | `BUNDLE_VERSION` 2 writes JSON; `readBundle` still accepts version-1 Markdown bundles                                            |
| Two copies of book table data (Markdown + JSON) exist      | Deliberate — Markdown is the licensed source, JSON is generated; `tables:check` is the guard, and it runs in CI                  |

## Order of work

Phase 0 lands alone and first. Phases 1 and 2 can land together while the system-set GET response remains
backward-compatible. Phase 3 changes the response and editor together and lands alone (it is the only phase that
touches anyone's data). Phase 4 lands last, because it is the only phase a user can see.
