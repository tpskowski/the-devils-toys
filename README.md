# The Devil's Toys

A local-first virtual tabletop for Cairn and Monolith. The first release focuses on a persistent room, a fast shared table, rules at hand, and useful GM controls without trying to automate the games away.

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

## Production

```sh
npm run build
npm start
```

The production server serves both the API and `client/dist` at `http://localhost:4000`.

Mutable data defaults to `.data/` and can be moved with `DEVILS_TOYS_DATA_DIR`. The port can be set with `PORT`. See `.env.example`.

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
wslc container list
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

Server admins and room GMs have a **Players & characters** entry beneath the room list. Use it to create player sign-ins before granting room access, reset player passwords, and prepare Cairn or Monolith character records before choosing their player or room. Admins can assign account roles; GMs can create and add player-level accounts only. Downgrading an account that manages rooms requires confirmation and transfers those rooms to the acting admin.

A character's player and room are independent assignments. When setting both, give the player access to that room first. Full character-sheet details remain available from the room's Characters screen.

Editable character sheets accept PNG, JPEG, or WebP portraits up to 5 MB. Portraits are stored with the rest of the mutable application data and count toward `DEVILS_TOYS_UPLOAD_LIMIT_MB`.

The room Library accepts PNG, JPEG, or WebP images classified as Maps, Scenes, or References. References may also be UTF-8 Markdown (`.md`) files. The main table separates current Maps, current Scenes, and revealed References into dedicated tabs.

Maps and Scenes use `DEVILS_TOYS_SCENE_IMAGE_LIMIT_MB` (60 MB by default); image and Markdown References use `DEVILS_TOYS_REFERENCE_IMAGE_LIMIT_MB` (20 MB by default).

## Backups

Stop the server, copy the complete configured data directory, then restart. Restore by stopping the server and replacing that directory with a backup made while the server was stopped. Database, uploads, and logs are kept together so a single filesystem copy is sufficient.

## Content and licensing

The application code is released under the [MIT License](LICENSE).

The bundled rules text is not. Cairn by Yochai Gal and Monolith by Adam Hensley are each licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), and so is everything in this repository derived from them: the Markdown in `raw/`, the rules pages the server delivers, and the random tables, bestiary entries, and starship parts read out of those files. If you redistribute any of that, ShareAlike requires you to keep it under the same licence and to credit the authors.

Attributions, the changes made to each source, and what is deliberately _not_ redistributed here are recorded in [NOTICE.md](NOTICE.md), and shown in the app under Credits.
