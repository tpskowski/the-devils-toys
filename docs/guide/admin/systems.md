# Game systems

[← Back to the admin guide](README.md)

The application ships with Cairn, Monolith, and Cities Without Number. A server
admin can also install a game system at runtime as a `.devilsystem.zip`, without
rebuilding or restarting the server.

The importer is deliberately data-only. A bundle contains:

- `manifest.json`, identifying the format, system, export time, and licences;
- `system.json`, the declarative sheet, dice, content, warning, NPC, and group
  definitions;
- `items.json` and `traits.json`;
- rules and corrections Markdown under `rules/`;
- extracted runtime table sets under `tables/` as JSON.

JavaScript, CSS, executable plugins, arbitrary assets, and paths outside those
locations are refused. Installation validates the bundle structure and system
definition, then stages the files and moves them into place as one unit.

## Current control surface

System management is currently exposed through the authenticated game-server
API. Every write and every export requires a signed-in server-admin session.
Anyone signed in may list the registry.

| Operation          | Request                                                      | Result                                                                |
| ------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| List               | `GET /api/admin/systems`                                     | Built-in and installed systems, status, and room/character use counts |
| Install or replace | `POST /api/admin/systems`                                    | Multipart form with the bundle in a field named `bundle`              |
| Export             | `GET /api/admin/systems/<id>/export`                         | Downloads `<id>.devilsystem.zip`                                      |
| Clone on export    | `GET /api/admin/systems/<id>/export?as=<new-id>&name=<name>` | Rewrites the system-owned ids and downloads an installable sibling    |
| Retire             | `POST /api/admin/systems/<id>/retire`                        | Removes it from the choices for a new room                            |
| Restore            | `POST /api/admin/systems/<id>/restore`                       | Offers it for new rooms again                                         |
| Delete             | `DELETE /api/admin/systems/<id>`                             | Removes an unused installed system and its files                      |

The upload limit is 25 MB by default and can be changed with
`DEVILS_TOYS_SYSTEM_LIMIT_MB` before starting the server.

Installing another bundle with the same installed id is an atomic replacement.
Open requests start using the new definition immediately; a restart is not
required. A bundle may not replace one of the systems that ships with the
application.

## Retire or delete

Retirement is the safe choice for a system that has been used. It prevents new
rooms from choosing it while existing rooms and characters continue to load and
play normally. Restoring reverses that choice.

Deletion is only for an installed system with no room and no character pointing
at it. The server refuses deletion otherwise and reports the use counts. A
built-in system cannot be deleted.

## Files, backups, and licences

Installed files live under `systems/<id>/` inside `DEVILS_TOYS_DATA_DIR`; the
database holds the corresponding registry record. Do not install a system by
copying that directory by hand, and do not back up one half without the other.
The complete stopped-server backup in [Operating the server](operating.md#backups)
preserves both.

An exported bundle carries the licence strings and source files declared by its
system definition. That preserves attribution; it does not grant permission to
redistribute a rulebook. Confirm the source licence before installing or sharing
a bundle.

---

[← Rooms](rooms.md) · [Operating the server →](operating.md)
