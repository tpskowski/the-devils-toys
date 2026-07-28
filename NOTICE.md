# Notices

This repository contains two kinds of material under two different licences.

| Material                                                                                                                       | Licence                                                   |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| The application: everything under `client/`, `server/`, `shared/`, `systems/`, `scripts/`, and the project's own documentation | MIT — see [LICENSE](LICENSE)                              |
| The game rules text in `raw/`, and anything in this repository derived from it                                                 | Creative Commons Attribution-ShareAlike 4.0 International |

The application code is not an adaptation of the rules text, so MIT applies to it. Anything that reproduces or adapts the rules text — the Markdown in `raw/`, the rules pages the application serves, and the random tables, bestiary entries, and starship parts it reads out of those files — remains under CC BY-SA 4.0 and must stay under those terms if you redistribute it.

Full licence text: <https://creativecommons.org/licenses/by-sa/4.0/legalcode>. Summary: <https://creativecommons.org/licenses/by-sa/4.0/>.

## Cairn

**Cairn** by Yochai Gal, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

- Author's page: <https://yochaigal.itch.io/cairn>. Project site: <https://cairnrpg.com>.
- Cairn features public domain art by Wilhelm Jordan, W. Heath Robinson, Rolf Von Hoerschelmann, Arthur Rackham, and Arthur Layard. That art is not included here.
- Changes made: the text was converted to Markdown for this application and the art and layout were dropped. Any repair to the wording itself is recorded in [`raw/corrections.md`](raw/corrections.md).

## Monolith

**Monolith: Interstellar Science-Fiction Adventure**, version 1.1 (January 2023), by Adam Hensley, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

- Author's page: <https://adamhensley.itch.io/>.
- Monolith is a science-fiction hack of Cairn by Yochai Gal.
- Changes made: as noted in the source, the text is reprinted with minor changes for the digital format and with the art removed. Any repair to the wording itself is recorded in [`raw/corrections.md`](raw/corrections.md).

Neither author endorses this project, and neither has reviewed it.

## Not redistributed here

- The original PDFs of both books are ignored by Git and are not published in this repository. Buy or download them from the authors' pages above.
- Fonts are not vendored. Inter, DM Mono, and Unbounded are installed from Fontsource under the [SIL Open Font License 1.1](https://openfontlicense.org/); their licence files ship inside those packages.
- Third-party JavaScript dependencies keep their own licences, available in `node_modules` after `npm install`.
- Anything a table uploads at runtime — audio, images, Markdown references — stays in the server's data directory, which is ignored by Git. Nothing a group adds to a room is part of this repository.
