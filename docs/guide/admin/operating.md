# Operating the server

[← Back to the admin guide](README.md)

## Where the data lives

Everything mutable sits under one directory — `.data/` by default, moved with
`DEVILS_TOYS_DATA_DIR`:

```
.data/
  devils-toys.sqlite    the database
  uploads/              every uploaded file
  logs/server.log       the server log
```

They are kept together deliberately, so one filesystem copy is a complete
backup. Nothing the application writes lives anywhere else.

## Configuration

Set through the environment; `.env.example` in the repository lists them all.

| Variable                               | Default | What it does                                                                  |
| -------------------------------------- | ------- | ----------------------------------------------------------------------------- |
| `PORT`                                 | `4000`  | The game server's port.                                                       |
| `DEVILS_TABLES_PORT`                   | `4100`  | The table editor's port.                                                      |
| `DEVILS_TABLES_URL`                    | —       | Where a browser can reach the editor. Set only when a reverse proxy moves it. |
| `DEVILS_TOYS_DATA_DIR`                 | `.data` | Everything above.                                                             |
| `DEVILS_TOYS_LOG_LEVEL`                | `info`  | Log verbosity.                                                                |
| `DEVILS_TOYS_UPLOAD_LIMIT_MB`          | `1024`  | Total upload storage for the whole server.                                    |
| `DEVILS_TOYS_SCENE_IMAGE_LIMIT_MB`     | `60`    | Largest single map or scene.                                                  |
| `DEVILS_TOYS_REFERENCE_IMAGE_LIMIT_MB` | `20`    | Largest single reference.                                                     |
| `DEVILS_TOYS_AUDIO_LIMIT_MB`           | `50`    | Largest single MP3.                                                           |

## Storage, and what counts toward it

`DEVILS_TOYS_UPLOAD_LIMIT_MB` is one allowance for the **whole server**, not per
room and not per account. Counted against it:

- every map, scene, reference, and audio track in every room;
- character portraits;
- hireling and shared-asset portraits.

Character portraits are additionally capped at 5 MB each and must be PNG, JPEG,
or WebP.

When the allowance is reached, uploads are refused with _The server
upload-storage allowance has been reached._ Nothing is deleted to make room and
nothing warns you as it fills up, so if your table is media-heavy, watch the
size of `uploads/` rather than waiting to be told. Raising the limit takes a
restart; deleting a room reclaims its files immediately.

## Backups

The whole procedure:

1. **Stop the server.**
2. Copy the entire data directory somewhere else.
3. Start the server.

Restore by stopping the server, replacing that directory with a copy taken while
the server was stopped, and starting it again.

Copy it _stopped_. The database runs in WAL mode, so a copy taken from a running
server can be an inconsistent snapshot — one that appears to work and is missing
the most recent writes.

**Back up before every upgrade.** Schema migrations run automatically at start
and are not reversible. Restoring the directory is the only way back.

## Logs

`logs/server.log` in the data directory, at the verbosity
`DEVILS_TOYS_LOG_LEVEL` sets. One JSON object per line, written to the file and
to standard output.

Fields whose names look like a secret — password, token, secret, authorization,
cookie — are written as `[redacted]`, so the log is safe to read and to attach
to a bug report without combing through it first.

Nothing rotates it. On a long-lived instance, truncate or rotate it yourself.

## Upgrading

```bash
git pull && npm install && npm run build
```

Then restart. The database migrates itself on start; there is nothing to run by
hand.

Take a backup first. See above — this is the paragraph you will wish you had
read.

## The Devil's Tables

The random-table editor is a **second process** against the same database, on
`DEVILS_TABLES_PORT`:

```bash
npm run start:tables
```

It has no rooms, no media, and no WebSockets, and it starts and runs with the
game server stopped. Nothing about a game depends on it being up: when it is not
answering, the game's rail says _Not running_ and offers the command that starts
it rather than a link that fails.

It shares the session cookie, which is scoped by host rather than port, so
signing in to either signs you in to both.

Three levels apply there, and the top one is yours alone:

- anyone signed in **reads** the catalogue;
- a GM **authors** tables for this instance;
- an **admin** also merges, retires, and re-slugs tags, and produces repository
  bundles.

Those are admin-only for a reason worth remembering before you use them:
re-slugging or retiring a tag **rewrites every set that uses it**, including
sets a GM wrote and you have never read. A repository bundle is a change to the
application rather than to this instance.

Using the editor — adding tables, tagging, CSV import, moving sets between
instances — is written up in
[devils-tables.md](../../../devils-tables.md), which the editor serves as its
own **Guide** page.

## Content and licensing

The bundled rulebooks are redistributed under their authors' licences, and what
is deliberately _not_ redistributed is recorded in
[NOTICE.md](../../../NOTICE.md). If you are running this for a group, that file
is the one to read before you put a copy of a book anywhere public.

---

[← Rooms](rooms.md) · [Back to the admin guide](README.md)
