# Table storage migration

System and custom tables have different storage requirements.

## Active formats

- System catalogues are generated JSON files under `raw/tables/`. They are compiled from the authoritative rulebook
  Markdown and include parser provenance for verification and access classification.
- Custom sets remain Markdown in `table_sets.markdown`. That document is the sole source of truth for the roller,
  The Devil's Tables editor, imports, and exports.

Custom Markdown is parsed with the same `parseRollTables` implementation used for system sources. Parsed tables retain
their `RollTable.source` ranges. A grid edit is written with `spliceTable`, replacing only the recorded table lines and
leaving headings, prose, comments, blank lines, preambles, postambles, and content between tables intact. `serializeSet`
is reserved for data that has no source document to preserve, such as CSV imports, legacy JSON bundles, and repository
bundles.

## Database compatibility

The active `table_sets` schema stores `markdown TEXT NOT NULL` and set-level `tags_json`. A database created during the
short-lived JSON migration is rebuilt on startup. Its exact `migration_markdown` backup is restored when present; a
JSON-only row is serialized to Markdown once because no original source remains. The migration is detected from
`sqlite_master`/`PRAGMA table_info`, is idempotent, and performs the constraint-preserving rebuild with foreign keys
disabled outside the transaction.

## Validation

- System JSON generation and verification compare the JSON structure with the parsed authoritative Markdown.
- The verifier also reads physical Markdown table cells independently of the conversion parser. It rejects invalid dice,
  invalid provenance bounds, unordered or overlapping source ranges, cell mismatches, and unordered or overlapping roll
  ranges.
- Custom writes validate table tags against the database vocabulary. Legacy JSON bundle parsing must receive the
  effective vocabulary, including tag definitions carried by the bundle.
- Player-facing rule-table reads require an explicit `player` classification; missing and `gm` classifications are not
  exposed.

## Rollout checks

1. Generate system JSON and confirm the manifest baseline has not changed unexpectedly.
2. Run the independent Markdown/JSON verifier.
3. Run parser round-trip, bundle, database migration, tag, server, client, and tables-client tests.
4. Build all workspaces before deployment.

Markdown remains the required custom-table workflow throughout this rollout; it is not a rollback-only copy or a second
representation of custom table data.
