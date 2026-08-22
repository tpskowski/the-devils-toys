# The Devil's Toys

A local-first virtual tabletop. It ships no game system: an admin installs one at runtime, from a repository or a file, and a server can run as many as it likes. It focuses on a persistent room, a fast shared table, rules at hand, and useful GM controls without trying to automate the games away.

**This is alpha software.** It runs and it is used, but nothing is settled: interfaces move, and data shapes still change between versions — migrations run on start, so keep the backups described under [Backups](#backups).

## Guides

- [Player's Guide](docs/guide/README.md) — joining a table, the sheet, dice, and combat.
- [GM's Guide](docs/guide/gm/README.md) — your room, Room Config, NPCs and encounters, and running a session.
- [Admin's Guide](docs/guide/admin/README.md) — first run, accounts and roles, rooms, installable game systems, and operating the server.
- [The Devil's Tables](devils-tables.md) — using the random-table editor.

## Requirements

Use either:

- Node.js 22.5 or newer with npm 10 or newer, or
- Windows with WSL Containers (`wslc`) from WSL 2.9.3 or newer.

## Start developing

```sh
npm install
npm run dev
```

Open `http://localhost:10666`. Vite forwards API and WebSocket traffic to the Node server on port 4000.

## The Devil's Tables

A second application in this repository, for writing and curating the random tables the games roll on. It runs on its own port against the same database, so it can be started, stopped, and updated without touching a game in progress.

```sh
npm run dev:tables
```

Open `http://localhost:10667`. Vite forwards API traffic to the tables server on port 4100.

Admins and GMs reach it from **The Devil's Tables** in the game's left rail, beneath the room list. Because it is a separate process, the game checks whether it is answering: when it is, the rail links straight to it; when it is not, the row reads _Not running_ and opens a panel with the command to start it. Nothing about a game depends on it being up.

That link points at this host on `DEVILS_TABLES_PORT`. Set `DEVILS_TABLES_URL` when a reverse proxy serves the editor somewhere else.

It signs in with the same accounts as The Devil's Toys — the session cookie is scoped to the host rather than the port, so signing in to either signs you in to both. Accounts are still created in The Devil's Toys. An admin can do everything; a GM writes tables for this instance; a player can read the catalogue but change nothing.

It edits tables as grids, manages the tag vocabulary, imports CSV against a downloadable template, and produces two kinds of zip archive: a bundle for moving sets into another copy of the application, and a JSON repository bundle whose CLI previews and confirms changes before installing standalone built-in table sets.

How to use it — adding tables, tagging them, importing CSV, and moving sets between instances — is written up in [devils-tables.md](devils-tables.md), which the editor also serves as its **Guide** page.

## Production

```sh
npm run build
npm start
```

The production server serves both the API and `client/dist` at `http://localhost:4000`. To serve the table editor as well, run `npm run start:tables` alongside it; it serves the API and `tables-client/dist` at `http://localhost:4100`.

Mutable data defaults to `.data/` and can be moved with `DEVILS_TOYS_DATA_DIR`. The ports can be set with `PORT` and `DEVILS_TABLES_PORT`. See `.env.example`.

## Game systems

This repository is the tabletop. A game system — its rules text, tables, gear, and the declarative definition that lays out a character sheet — lives in a repository of its own and is installed into a running server. Nothing needs rebuilding or restarting, and a fresh server can do nothing at all until one is installed.

An admin installs one under **Management → Systems**, three ways: from the catalogue, from any repository the server is allowed to reach (paste its GitHub address), or from a `.devilsystem.zip` exported elsewhere. All three end in the same checks, in the same order — arriving over the network buys no trust.

A system is data. It carries a declarative definition, catalogues, Markdown, and table JSON, and it cannot carry executable extensions, custom CSS, or client code: the installer will not run code and there is nowhere in the format to put any.

The catalogue is [devils-toys-systems](https://github.com/tpskowski/devils-toys-systems), and a server comes pointed at it. Set `DEVILS_TOYS_SYSTEM_CATALOG_URL` to offer a different menu, or to an empty string for none — installing by repository or from a file works either way. Fetching a system is the only outbound connection this server makes, and `DEVILS_TOYS_SYSTEM_HOSTS` is the allowlist it may make it to.

Installed content is kept under `systems/` inside `DEVILS_TOYS_DATA_DIR` and registered in the database. Retiring a system only removes it from new-room choices; rooms and characters already using it keep working. Because the files and the registry row belong together, back up and restore the whole data directory rather than copying one system out of it.

See [Game systems](docs/guide/admin/systems.md) in the Admin's Guide for the lifecycle, and [`schema/`](schema) for what a system may declare.

### Writing one

Start from the `devils-toys-example` scaffold — a complete, deliberately tiny system to copy and rename. Then, from a checkout of this repository beside yours:

```
npm run systems:validate -- ../devils-toys-yours    # exactly the checks an install runs
npm run systems:bundle   -- ../devils-toys-yours    # make an installable .devilsystem.zip locally
npm run systems:catalog  -- ../devils-toys-yours    # rebuild items.json and traits.json from the book
npx tsx scripts/tables-md-to-json.ts --repo ../devils-toys-yours   # rebuild the extracted tables
```

`npm run systems:export -- <id> --out <dir>` writes any installed system out as a repository, which is also how the systems that used to live here were split out.

`systems:bundle` reads a system repository, runs the complete install validation,
and writes `<id>.devilsystem.zip` into that repository by default. Use `--out
<file>` to put it elsewhere. The bundle carries the release declared in
`devilsystem.json` and is ready for **Management → Systems → From a file**;
unlike `systems:export`, it does not require the system to be installed first.
Format-2 markers may also set `breaking: true` with plain-text `releaseNotes`.
Replacing an installed release then requires an administrator to review and
explicitly acknowledge those notes before any system content is changed.

## Run with WSLC on Windows

[WSL Containers](https://learn.microsoft.com/en-us/windows/wsl/tutorials/wsl-containers) can build and run the included `Dockerfile` without Docker Desktop or a separate container engine. WSLC entered public preview in [WSL 2.9.3](https://github.com/microsoft/WSL/releases/tag/2.9.3).

Open PowerShell in the project directory. Update WSL, verify that WSLC is available, and run its smoke image:

```powershell
wsl --update
wslc version
wslc run --rm hello-world
```

Build the application image and create its persistent data volume. Run `wslc volume create` only during first-time setup; if it reports `ERROR_ALREADY_EXISTS`, keep the existing volume and continue:

```powershell
wslc build -t devils-toys:local .
wslc volume create devils-toys-data
```

Create and start the application:

```powershell
wslc run -d -p 4000:4000 --name devils-toys `
  -v devils-toys-data:/data `
  -e DEVILS_TOYS_UPLOAD_LIMIT_MB=1024 `
  devils-toys:local
```

Open `http://localhost:4000`. The named volume keeps the database, uploads, and logs when the container is stopped or replaced.

Useful lifecycle commands:

```powershell
wslc container list -all
wslc container logs devils-toys
wslc container stop devils-toys
wslc container start devils-toys
```

After updating the application, rebuild and replace only the container. The `devils-toys-data` volume is preserved:

```powershell
wslc build -t devils-toys:local .
wslc container stop devils-toys
wslc container remove devils-toys
wslc run -d -p 4000:4000 --name devils-toys `
  -v devils-toys-data:/data `
  -e DEVILS_TOYS_UPLOAD_LIMIT_MB=1024 `
  devils-toys:local
```

Do not run `wslc volume remove devils-toys-data` unless you intend to permanently delete all application data.

## Prepare players and characters

Server admins and room GMs have a management entry beneath the room list — **Management** for an admin, **Players & characters** for a GM. Use it to create player sign-ins before granting room access, reset player passwords, and prepare character records before choosing their player or room. Admins also install and retire game systems from here. Admins can assign account roles; GMs can create and add player-level accounts only. Downgrading an account that manages rooms requires confirmation and transfers those rooms to the acting admin.

A character's player and room are independent assignments. When setting both, give the player access to that room first. Full character-sheet details remain available from the room's Characters screen.

Editable character sheets accept PNG, JPEG, or WebP portraits up to 5 MB. Portraits are stored with the rest of the mutable application data and count toward `DEVILS_TOYS_UPLOAD_LIMIT_MB`.

The room Library accepts PNG, JPEG, or WebP images classified as Maps, Scenes, or References. References may also be UTF-8 Markdown (`.md`) files. The main table gives Maps, Scenes, and revealed References a tab each, alongside the party, the current encounter, and the rules.

Maps and Scenes use `DEVILS_TOYS_SCENE_IMAGE_LIMIT_MB` (60 MB by default); image and Markdown References use `DEVILS_TOYS_REFERENCE_IMAGE_LIMIT_MB` (20 MB by default).

## Accounts, when nobody can sign in

An admin can reset any account's password from the application, including another admin's. If the last admin is locked out there is no way in through it, so three things can be done from the machine the database is on:

```sh
npm run accounts list
npm run accounts reset <username>     # asks twice, hidden; signs that account out everywhere
npm run accounts delete <username>    # only for an account that has done nothing
```

A password is asked for rather than passed as an argument, since an argument is visible to other processes and lands in shell history. See [Operating the server](docs/guide/admin/operating.md).

## Backups

Stop the server, copy the complete configured data directory, then restart. Restore by stopping the server and replacing that directory with a backup made while the server was stopped. Database, installed systems, uploads, and logs are kept together so a single filesystem copy is sufficient.

## The landing page's quotes

The page you land on after signing in opens with a quote, drawn at random each
time it loads. They live in [quotes.md](quotes.md) at the root of the repository,
and that file is the whole of the feature: the quote, whoever said it on the last
line, a blank line, then the next one.

```text
It's time we find out if this ship is capable of deicide.
Misato Katsuragi

"The world is indeed full of peril and in it there are many dark places."
J.R.R. Tolkien
```

Add one by typing it there. Nothing is generated from the file and there is no
second list to keep level with it — the client reads it as it is built, so a new
quote appears on the next reload under `npm run dev`, and on the next
`npm run build` for a deployed server.

Four things the reader does with what it finds:

- **Quotation marks are optional.** A quote wrapped in `"straight"` or `“curly”`
  marks has them taken off, and the page puts its own pair back. One written
  bare gets the same pair.
- **Line breaks are kept**, so a verse stays a verse.
- **An exchange keeps its own marks.** Where every line carries its own pair, the
  page adds none — one pair around two speakers puts both halves in one mouth.
- **A dash in front of a name is dropped**, so `-Pippin Took` and `Pippin Took`
  read the same.

Long quotes are set smaller than short ones so that the room list stays on
screen. There is no heading in the file and no front matter: a block of lines is
a quote, and a block that is only one line is ignored rather than shown without
anyone behind it. `client/src/quotes.test.ts` reads the real file and fails if a
block in it stops parsing.

## Content and licensing

The application code is released under the [MIT License](LICENSE).

No game system is distributed with it. A system carries its own rules text under its own licence, in its own repository, and states that licence in its `devilsystem.json` — which the server reports when it is installed.

Cairn, Monolith, and Cities Without Number were part of this repository until the systems were split out. Each is now a repository of its own carrying its own attribution and record of changes; [Monolith](https://github.com/tpskowski/devils-toys-monolith) is published.

What this repository does and does not redistribute is recorded in [NOTICE.md](NOTICE.md), and shown in the app under Credits. An operator is responsible for what they install.
