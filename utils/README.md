# Local development launchers

These scripts start either the local npm development applications or the
repository's containerized services. The two modes are alternatives because
they publish the same backend ports.

The scripts can run directly from this directory or be copied to the repository
root. Root copies are intentionally ignored by Git.

## Windows

PowerShell starts the npm applications by default and uses WSLC for container
mode:

```powershell
.\utils\dev-local.ps1
.\utils\dev-local.ps1 -Runtime Wslc
.\utils\dev-local.ps1 -Kill
```

To keep a personal root-level copy:

```powershell
Copy-Item .\utils\dev-local.ps1 .\dev-local.ps1
```

The WSLC container must already exist as `devils-toys`. Follow the root
`README.md` to build and create it. Pass `-ContainerName NAME` if it has another
name.

## Linux

```bash
bash utils/dev-local-linux.sh
bash utils/dev-local-linux.sh --runtime docker
bash utils/dev-local-linux.sh --kill
```

To keep a personal executable root-level copy:

```bash
cp utils/dev-local-linux.sh ./dev-local-linux.sh
chmod +x ./dev-local-linux.sh
```

## macOS

```bash
bash utils/dev-local-macos.sh
bash utils/dev-local-macos.sh --runtime docker
bash utils/dev-local-macos.sh --kill
```

To keep a personal executable root-level copy:

```bash
cp utils/dev-local-macos.sh ./dev-local-macos.sh
chmod +x ./dev-local-macos.sh
```

Docker mode uses `docker compose up -d` and `docker compose stop` with the
repository's `docker-compose.yml`. It requires Docker Engine with the Compose
plugin on Linux, or Docker Desktop (or another compatible Docker CLI) on macOS.

npm mode starts both `npm run dev` and `npm run dev:tables`. Process IDs and
logs are stored below `.tmp-local-server/`. The kill option stops tracked npm
process trees, checks the project's known web ports for orphaned processes, and
then stops the container services.
