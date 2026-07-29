# Cities Without Number source corrections

`CitiesWithoutNumberSRDv1.0.html` is the canonical source. `CitiesWithoutNumberSRDv1.0.md` is the runtime Markdown derivative used by the application.

The entries below record every intentional difference from the canonical visible text. Markdown-only structure changes are listed separately because they do not alter wording.

## Numbering repairs

| Location | Canonical HTML | Runtime Markdown | Reason |
| --- | --- | --- | --- |
| Final Character Creation Steps | `1.7.5 Choose Starting Gear` | `1.7.6 Choose Starting Gear` | The canonical source repeats 1.7.5 after “Choose Starting Languages.” |
| Final Character Creation Steps | `1.7.6 Choose a Name and Goal` | `1.7.7 Choose a Name and Goal` | Renumbered after repairing the duplicate immediately above it. |

## Markdown structure repairs

These changes preserve the canonical wording exactly.

| Location | Change | Reason |
| --- | --- | --- |
| `1.6.1 Focus List` | Changed from a level-two to a level-three Markdown heading. | Its number makes it a child of `1.6.0 Foci`, matching adjacent sections. |
| `2.6.1 Foot Chases` | Changed from a level-four to a level-three Markdown heading. | Its number makes it a direct child of `2.6.0 Chases and Pursuit`. |
| `2.6.2 Vehicle Chases` | Changed from a level-four to a level-three Markdown heading. | Its number makes it a direct child of `2.6.0 Chases and Pursuit`. |
| `3.0.0 Gear, Vehicles, and Cyberware` | Promoted from an ordinary paragraph to a level-one Markdown heading. | It is the missing chapter heading between chapters 2 and 4. |
| `3.1.0 Mission Gear` | Promoted from an ordinary paragraph to a level-two Markdown heading. | It is the first section of chapter 3. |
| `6.1.3.5 Spell List` | Promoted from an ordinary paragraph to a level-four Markdown heading. | Its number makes it a child of `6.1.3 Spells`. |
| `6.2.3.2 Immediate Spirit Summonings` | Promoted from an ordinary paragraph to a level-four Markdown heading. | Its number makes it a child of `6.2.3 Calling and Dismissing Spirits`. |
| `6.2.8 Spirit Powers` | Promoted from an ordinary paragraph to a level-three Markdown heading. | Its number makes it a direct child of `6.2.0 Summoners and Summoning`. |
| Background Growth and Learning tables | Split paired fixed-width blocks into separate Markdown tables under added background/table headings. | Makes both dice tables independently rollable while preserving every cell. |
| `3.6.1.1 Implant Complications` | Converted the twelve fixed-width entries to a `d12` Markdown table. | Restores the canonical table's semantics for the random-table parser. |
| `5.1.0 Reaction Rolls` | Converted the six fixed-width entries to a `2d6` Markdown table, retaining the canonical `2-` and `12+` open ranges. | Preserves reactions to modified totals rather than narrowing them to unmodified 2–12 results. |
| `6.1.3.3 Overcasting` | Converted the twenty fixed-width entries to a `d20` Markdown table, retaining the canonical `1-` and `20+` open ranges. | Restores the canonical table's semantics for the random-table parser. |
| Table discovery tags | Added invisible Markdown comments to mark background tables as `character-building` and Reaction Rolls as `random-encounter`. | Supplies application classification without changing rendered rules text. |
| Antagonist names | Promoted to level-three Markdown headings beneath their existing category headings. | Makes the canonical stat blocks individually addressable by the GM catalog. |

## Wording repairs

No wording repairs have been made.
