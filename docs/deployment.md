# Deployment

## Local Node.js

Install Node.js 22.5 or later, run `npm ci`, then `npm run build` and `npm start`. Put the process behind a reverse proxy for TLS when exposing it beyond a trusted local network. Persist and back up the directory configured by `DEVILS_TOYS_DATA_DIR`.

## WSL Containers on Windows

WSLC is the preferred container path on supported Windows systems and does not require Docker Desktop. With WSL 2.9.3 or newer, run the tested commands in the README to build `devils-toys:local`, create the `devils-toys-data` volume, and publish the application on port 4000.

The application container mounts the named volume at `/data`. Stop the container before backing up or restoring that volume. Removing and recreating the container does not remove the named volume.

## Docker

Docker remains supported as an alternative. Run `docker compose up --build -d`. The included compose file publishes port 4000 and stores mutable state in the `devils-toys-data` volume. Back up that volume while the container is stopped.

## Cloud-ready operation

Use one application instance with a persistent volume mounted at `/data`; the first release does not coordinate multiple Node processes. Set `DEVILS_TOYS_DATA_DIR=/data`, terminate TLS at the platform edge, and make sure WebSocket upgrades reach the same process. Do not use an ephemeral filesystem for `/data`.

The application collects no telemetry. Restrict the service at the network or reverse-proxy layer until the initial GM account has been created.
