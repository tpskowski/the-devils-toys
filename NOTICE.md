# Notices

This repository contains application code and several independently licensed rules sources.

| Material                                                                                                                       | Licence                                                   |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| The application: everything under `client/`, `server/`, `shared/`, `systems/`, `scripts/`, and the project's own documentation | MIT — see [LICENSE](LICENSE)                              |
| Cairn and Monolith source text and material derived from those sources                                                         | Creative Commons Attribution-ShareAlike 4.0 International |
| Cities Without Number source text and material derived from that source                                                        | CC0 1.0 Universal                                         |

The application code is not an adaptation of the rules text. Rules pages, extracted tables, antagonist entries, and other source-derived content retain the licence of the source they reproduce or adapt.

## Cairn

**Cairn** by Yochai Gal, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

- Author's page: <https://yochaigal.itch.io/cairn>. Project site: <https://cairnrpg.com>.
- Cairn features public domain art by Wilhelm Jordan, W. Heath Robinson, Rolf Von Hoerschelmann, Arthur Rackham, and Arthur Layard. That art is not included here.
- Changes made: the text was converted to Markdown for this application and the art and layout were dropped. Repairs are recorded in [`raw/corrections.md`](raw/corrections.md).

## Monolith

**Monolith: Interstellar Science-Fiction Adventure**, version 1.1 (January 2023), by Adam Hensley, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

- Author's page: <https://adamhensley.itch.io/>.
- Monolith is a science-fiction hack of Cairn by Yochai Gal.
- Changes made: as noted in the source, the text is reprinted with minor changes for the digital format and with the art removed. Repairs are recorded in [`raw/corrections.md`](raw/corrections.md).

## Cities Without Number

**Cities Without Number**, version 1.0, by Kevin Crawford, released under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).

- Publisher's page: <https://sine-nomine-publishing.myshopify.com/>.
- The canonical source is [`raw/CitiesWithoutNumberSRDv1.0.html`](raw/CitiesWithoutNumberSRDv1.0.html); the application serves its Markdown derivative.
- Numbering repairs and Markdown-only structural changes are recorded in [`raw/citieswithoutnumber-corrections.md`](raw/citieswithoutnumber-corrections.md). No wording repairs have been made.

None of the authors endorses this project or has reviewed it.

## Not redistributed here

- The original PDFs are ignored by Git and are not published in this repository. Buy or download them from the authors' pages above.
- Fonts are not vendored. Inter, DM Mono, and Unbounded are installed from Fontsource under the [SIL Open Font License 1.1](https://openfontlicense.org/); their licence files ship inside those packages.
- Third-party JavaScript dependencies keep their own licences, available in `node_modules` after `npm install`.
- Anything a table uploads at runtime — audio, images, Markdown references — stays in the server's data directory, which is ignored by Git. Nothing a group adds to a room is part of this repository.
