# The Devil's Toys

A local-first virtual tabletop that ships with Cairn, Monolith, and Cities Without Number and can accept additional data-only game-system bundles at runtime. It focuses on a persistent room, a fast shared table, rules at hand, and useful GM controls without trying to automate the games away.

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

## Installable game systems

A server admin can install a `.devilsystem.zip` without rebuilding or restarting the application. A system bundle contains a declarative system definition, its item and trait catalogues, rules Markdown, and extracted table JSON; it cannot contain executable extensions, custom CSS, or client code.

The current control surface is the authenticated admin API under `/api/admin/systems`. It lists systems, accepts a bundle upload, exports any built-in or installed system, retires and restores systems, and deletes an installed system that no room or character still uses. Exporting with a new `as` id produces a clone that can be installed beside its source.

Installed systems are kept under `systems/` inside `DEVILS_TOYS_DATA_DIR` and registered in the database. Retiring one only removes it from new-room choices; rooms and characters already using it continue to work. Because the files and registry row belong together, back up and restore the complete data directory rather than copying an installed system by itself. See [Game systems](docs/guide/admin/systems.md) in the Admin's Guide for the lifecycle and API.

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

Server admins and room GMs have a **Players & characters** entry beneath the room list. Use it to create player sign-ins before granting room access, reset player passwords, and prepare Cairn, Monolith, or Cities Without Number character records before choosing their player or room. Admins can assign account roles; GMs can create and add player-level accounts only. Downgrading an account that manages rooms requires confirmation and transfers those rooms to the acting admin.

A character's player and room are independent assignments. When setting both, give the player access to that room first. Full character-sheet details remain available from the room's Characters screen.

Editable character sheets accept PNG, JPEG, or WebP portraits up to 5 MB. Portraits are stored with the rest of the mutable application data and count toward `DEVILS_TOYS_UPLOAD_LIMIT_MB`.

The room Library accepts PNG, JPEG, or WebP images classified as Maps, Scenes, or References. References may also be UTF-8 Markdown (`.md`) files. The main table gives Maps, Scenes, and revealed References a tab each, alongside the party, the current encounter, and the rules.

Maps and Scenes use `DEVILS_TOYS_SCENE_IMAGE_LIMIT_MB` (60 MB by default); image and Markdown References use `DEVILS_TOYS_REFERENCE_IMAGE_LIMIT_MB` (20 MB by default).

## Backups

Stop the server, copy the complete configured data directory, then restart. Restore by stopping the server and replacing that directory with a backup made while the server was stopped. Database, installed systems, uploads, and logs are kept together so a single filesystem copy is sufficient.

## Content and licensing

The application code is released under the [MIT License](LICENSE).

The bundled rules use their authors' licences. Cairn by Yochai Gal and Monolith by Adam Hensley are licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); Cities Without Number by Kevin Crawford is released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Derived rules pages and extracted game data retain the licence of their source.

Attributions, the changes made to each source, and what is deliberately _not_ redistributed here are recorded in [NOTICE.md](NOTICE.md), and shown in the app under Credits.
