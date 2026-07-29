# Deployment

## Local Node.js

Install Node.js 22.5 or later, run `npm ci`, then `npm run build` and `npm start`. Put the process behind a reverse proxy for TLS when exposing it beyond a trusted local network. Persist and back up the directory configured by `DEVILS_TOYS_DATA_DIR`.

## The Devil's Tables

The table editor is a second process, started with `npm run start:tables` and listening on `DEVILS_TABLES_PORT` (4100 by default). It is optional: the game server does not need it, and it can be stopped and restarted while a game is running.

Give it the same `DEVILS_TOYS_DATA_DIR` as the game server — sharing the database is the point of it. Both processes open the same SQLite file in WAL mode with a busy timeout, and both apply the same idempotent schema on start, so the order they come up in does not matter. Only the game server holds WebSockets, so the single-process constraint below is unaffected.

Serve both from the same host. The session cookie is `sameSite=strict` and scoped by host rather than by port, so a reverse proxy that puts them on one hostname and different paths or ports keeps sign-in working across the two; putting them on different hostnames would not.

The game's left rail links to the editor for admins and GMs. It works that address out from the one the game was reached on plus `DEVILS_TABLES_PORT`, which is right for a direct deployment. Behind a reverse proxy that moves the editor, set `DEVILS_TABLES_URL` to the address a browser should use.

Because it is a second door onto the same data, restrict it at the network layer as you would the game server. A signed-in player can read every custom table's full text there, which the roller in a game deliberately does not show them.

## WSL Containers on Windows

WSLC is the preferred container path on supported Windows systems and does not require Docker Desktop. With WSL 2.9.3 or newer, run the tested commands in the README to build `devils-toys:local`, create the `devils-toys-data` volume, and publish the application on port 4000.

The application container mounts the named volume at `/data`. Stop the container before backing up or restoring that volume. Removing and recreating the container does not remove the named volume.

## Docker

Docker remains supported as an alternative. Run `docker compose up --build -d`. The included compose file publishes port 4000 for the game and 4100 for the table editor, both backed by the same `devils-toys-data` volume. Back up that volume while the containers are stopped. Run `docker compose up -d table` alone if the editor is not wanted.

## Cloud-ready operation

Use one game instance with a persistent volume mounted at `/data`; the first release does not coordinate multiple game processes. Set `DEVILS_TOYS_DATA_DIR=/data`, terminate TLS at the platform edge, and make sure WebSocket upgrades reach the same process. Do not use an ephemeral filesystem for `/data`.

The table editor may run beside it as a second process on the same volume, but only one of it as well. It writes to `table_sets` and `table_tags`, and a second writer on those would race the first. It sends no realtime events, so a game client picks up a table written there the next time the roller is opened.

The application collects no telemetry. Restrict the service at the network or reverse-proxy layer until the initial GM account has been created.
