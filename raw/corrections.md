# Source corrections

Record repairs with the source, original text, correction, and reason before changing imported wording.

No wording has been changed. The repairs below are to table structure only.

## Monolith — background tables given headings of their own

**Source:** `raw/Monolith.md`, the thirteen `#### STARTING GEAR` sections under BACKGROUNDS.

**Original:** each background's tables sat directly under one shared `STARTING GEAR` heading, with nothing between them.

**Correction:** each of the 36 tables now has a `##### <its result column>` heading above it — `##### Signature Weapon`, `##### Old Crew Specialty`, and so on.

**Reason:** the roller names a table after the heading that owns it, and adds the result column only to tell tables sharing a heading apart. Sharing one heading therefore produced "STARTING GEAR — Signature Weapon" for every one of them, which reads badly in the table list and buries the part a GM is looking for. The tables keep `STARTING GEAR` in their heading path, so the browser still groups them under it.

No table gained, lost, or altered a row.

## Monolith — background table catalogue labels

**Source:** `raw/Monolith.md`, the 36 tables under the twelve numbered BACKGROUNDS.

**Original:** each table heading named only the detail being generated, such as
`Signature Weapon` or `How Did You Escape?`.

**Correction:** each heading is prefixed with its background, such as
`Mercenary - Signature Weapon` and `Human Experiment - How Did You Escape?`.
Each table also carries a `character-building` classification comment.

**Reason:** background tables need to identify the character background they
belong to when shown outside the rulebook hierarchy, and need to be discoverable
with the other character-building tables. The comments are application metadata
and do not alter the rendered rules text.

No table gained, lost, or altered a row.

## Monolith — die values in background tables written as plain numbers

**Source:** `raw/Monolith.md`, the die column of 12 background tables (72 rows).

**Original:** `| 1 HP |`, `| 2 HP |`, … in the first column of tables such as Signature Weapon.

**Correction:** `| 1 |`, `| 2 |`, ….

**Reason:** the column is the table's die, and every one of those tables is a D6 whose value happens to equal the HP the character rolled. The annotation repeated what the die column already said and made the values read as text rather than as a roll.

**Worth knowing:** the annotation carried a real cross-reference. Monolith has one 1D6 give both starting HP and the background's signature gear, so "1 HP" told a reader which of their rolls this table keys off. That link now lives only in the surrounding rules text — "roll 1d6 HP, and reference the chart according to … their HP". Restore the annotation if that connection matters more than a clean die column.

The `4 HP | 5 HP | 6 HP` column headings of the GEAR PACKS chart are untouched: there HP is the axis of the chart rather than a die value.
