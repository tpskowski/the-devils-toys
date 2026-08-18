# Deployment

## Local Node.js

Install Node.js 22.5 or later, run `npm ci`, then `npm run build` and `npm start`. Put the process behind a reverse proxy for TLS when exposing it beyond a trusted local network. Persist and back up the directory configured by `DEVILS_TOYS_DATA_DIR`.

## Uploads, and the reverse proxy in front of them

A campaign bundle is the largest thing this application accepts: a room's maps
and music, in one zip, which is measured in hundreds of megabytes rather than the
kilobytes a game system weighs. Two limits decide whether one can arrive, and only
the second belongs to this application.

**The reverse proxy's body limit comes first**, and its default will refuse a
campaign before any of this application's own checks run. nginx allows **1 MB**
unless told otherwise, and answers a larger request with a 413 that says nothing
about what to do next:

```nginx
client_max_body_size 2048m;
```

Set it at least as high as `DEVILS_TOYS_CAMPAIGN_LIMIT_MB`, and give the upload
room to finish — `proxy_read_timeout` and `proxy_send_timeout` are counted per
read, not per request, but a slow connection sending a gigabyte still wants more
than the 60 seconds most defaults allow. Apache's `LimitRequestBody`, Caddy's
`request_body max_size`, and a cloud load balancer's own ceiling are the same
setting under other names. A platform whose limit cannot be raised is a platform
where campaigns have to be split.

**Then this application's own limits**, all optional and all documented in
`.env.example`:

| Setting                                | Default | What it holds                              |
| -------------------------------------- | ------- | ------------------------------------------ |
| `DEVILS_TOYS_CAMPAIGN_LIMIT_MB`        | 2048    | One campaign, expanded                     |
| `DEVILS_TOYS_CAMPAIGN_ENTRY_LIMIT`     | 5000    | Files in one campaign                      |
| `DEVILS_TOYS_UPLOAD_LIMIT_MB`          | 1024    | Everything this instance stores, all rooms |
| `DEVILS_TOYS_CAMPAIGN_STAGE_TTL_HOURS` | 24      | How long an unconfirmed upload waits       |

The instance allowance is the one that usually bites: a campaign is refused when
it would take the total past `DEVILS_TOYS_UPLOAD_LIMIT_MB`, whatever the campaign
limit says, and the preview shows that arithmetic before anything is written.

**Disk.** An import needs room for the campaign twice over while it is in
progress — once staged, once stored — because the upload is expanded under
`<dataDir>/imports/` before it lands in `<dataDir>/uploads/`. The move between
them is a rename rather than a copy, so the second copy is transient, but the
free space has to be there. Unconfirmed uploads are reaped on their TTL, and
`<dataDir>/imports/` is safe to empty while the server is stopped.

A campaign too large for any of this is split into parts that share a
`campaignId` and imported one after another, which is what the refusal says.

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

The table editor may run beside it as a second process on the same volume, but only one of it as well. It writes to `table_sets` and `table_tags`, and a second writer on those would race the first. It sends no realtime events, so a game client picks up a table written there the next time the roller is opened. It does notice a game system installed on the other process since it started, so an install does not need it restarted.

The application collects no telemetry. Restrict the service at the network or reverse-proxy layer until the initial GM account has been created.
