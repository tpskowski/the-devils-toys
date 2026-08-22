# Notices

This repository contains application code and no rules text at all.

| Material                                                                                                           | Licence                             |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| The application: everything under `client/`, `server/`, `shared/`, `scripts/`, and the project's own documentation | MIT — see [LICENSE](LICENSE)        |
| `fixtures/toybox` and `fixtures/plainbox`                                                                          | CC0 1.0 Universal                   |
| `quotes.md`                                                                                                        | Quoted with attribution — see below |

The application is not an adaptation of any rules text. A game system is
installed into a running server and carries its own licence; nothing in this
repository reproduces or adapts one.

## The test fixtures

`fixtures/toybox` and `fixtures/plainbox` are game systems written for this
repository's own test suite. They reprint no book and are dedicated to the public
domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). They
exist so that the application can be tested without depending on anyone's rules.

## The landing page's quotes

`quotes.md` is a list of short quotations — a line or two each — from novels,
films, and games, every one attributed to who said it, shown one at a time as an
epigraph on the landing page. They are quoted, not licensed: no claim is made
over any of them, and they are not covered by the MIT licence over the rest of
this repository. A server that would rather open with something else replaces the
file.

## Systems that used to be here

Cairn, Monolith, and Cities Without Number were maintained inside this repository
until the game systems were split out. Their text, the record of every change made
to it, and their licences moved with them:

- **Cairn** by Yochai Gal — CC BY-SA 4.0 — `devils-toys-cairn`
- **Monolith: Interstellar Science-Fiction Adventure** by Adam Hensley — CC BY-SA 4.0 — `devils-toys-monolith`
- **Cities Without Number** by Kevin Crawford — CC0 1.0 Universal — `devils-toys-cwn`

None of those authors endorses this project or has reviewed it.

## Not redistributed here

- **No rules text.** No rulebook, no extracted tables, no gear catalogue derived from anyone's book. What a server serves is what its operator installed, and that operator is responsible for having the right to.
- **No original PDFs.** They never were published here, and the repositories that carry the converted text do not publish them either.
- Fonts are not vendored. Inter, DM Mono, and Unbounded are installed from Fontsource under the [SIL Open Font License 1.1](https://openfontlicense.org/); their licence files ship inside those packages.
- Third-party JavaScript dependencies keep their own licences, available in `node_modules` after `npm install`.
- Anything a table uploads at runtime — audio, images, Markdown references — stays in the server's data directory, which is ignored by Git. Nothing a group adds to a room is part of this repository.
