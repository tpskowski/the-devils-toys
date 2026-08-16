# Game systems

[← Back to the admin guide](README.md)

The Devil's Toys ships no game system. It is the tabletop; a game system is
installed into it, and a server can run as many as it likes. Until one is
installed there is nothing for a room to be played on, so this is usually the
first thing a new server needs.

Everything on this page is an admin's. A GM configures a room; an admin decides
what the server can run at all.

## Installing one

Open **Management → Systems**. There are three ways in, and they end in the same
place — the same checks, in the same order, on the same files.

**From the catalogue.** A menu of published systems, which a server comes
configured with. Each entry says who wrote it and under what licence; the button
installs it, or updates it when the catalogue offers a newer version than the one
you have. A server with no catalogue configured says so rather than showing an
empty menu.

**From a repository.** Give it an owner and repository name, and a branch, tag,
or commit. This is how a system is installed while it is still being written, and
how a system that will never be listed is installed at all. The server fetches
the repository, reads the system out of it, and ignores everything a repository
carries that a system does not use — README, licence, workflows, notes.

**From a file.** A `.devilsystem.zip` exported from this or another server, for a
system that is not in a repository at all.

Installing is atomic. Open requests start using the new definition immediately
and no restart is needed; a bundle that fails any check leaves the previous
content and the previous registry entry exactly as they were.

## What a system may contain

Data, and nothing else:

- `devilsystem.json`, the marker saying which system this is and under what licence;
- `system.json`, the declarative sheet, dice, content, warning, NPC, and group definitions;
- `items.json` and `traits.json`, the gear catalogue and what its words mean;
- rules and corrections Markdown under `rules/`;
- extracted runtime table sets under `tables/` as JSON.

JavaScript, CSS, executable plugins, and paths outside those locations are
refused. This is not a plugin system with the dangerous parts removed — nothing
in the format is ever evaluated, and there is nowhere in it to put code.

`GET /api/systems/schema` serves the schema a `system.json` is checked against,
so an author can validate one before pushing it.

## Where a system may be fetched from

Importing is the one thing that makes this server open an outbound connection, so
where it may connect is a setting rather than an argument. `DEVILS_TOYS_SYSTEM_HOSTS`
is the allowlist, and it is checked on every redirect rather than once at the
start. Anything else — another host, plain HTTP, an address on your own network —
is refused before a connection is opened.

`DEVILS_TOYS_SYSTEM_CATALOG_URL` is the menu, and it comes set to the published
catalogue — a server that ships no game system and offers no way to find one has
nothing to do. Point it at your own index to offer a different menu, or set it to
an empty string for no menu at all. Nothing is fetched until an admin opens this
panel, and neither installing by repository nor installing from a file depends on
it.

## Retire or delete

Retirement is the safe choice for a system that has been used. It stops new rooms
choosing it while existing rooms and characters keep loading and playing normally.
Restoring reverses that.

Deletion is only for a system no room and no character points at. The server
refuses otherwise and names the rooms in the way, because a deleted system would
leave them pointing at nothing.

A system whose content will not load is listed as such rather than hidden. Its
rooms still open on whatever they already hold, and it can be replaced or removed.

## Files, backups, and licences

Installed content lives under `systems/<id>/` inside `DEVILS_TOYS_DATA_DIR`; the
database holds the matching registry row. The two belong together — do not
install a system by copying that directory in by hand, and do not back up one
half without the other. The stopped-server backup in
[Operating the server](operating.md#backups) preserves both.

A system states its own licence, which the server reports when it is installed
and shows under Credits. That records attribution; it does not grant permission
to redistribute a rulebook. Confirm the licence of anything you install, and of
anything you share.

## The API behind the panel

Every write and every export requires a signed-in server admin.

| Operation           | Request                                                             |
| ------------------- | ------------------------------------------------------------------- |
| List                | `GET /api/admin/systems`                                            |
| Catalogue           | `GET /api/admin/systems/catalog`                                    |
| Import              | `POST /api/admin/systems/import` with `{id}` or `{repository, ref}` |
| Install from a file | `POST /api/admin/systems` — multipart, bundle in `bundle`           |
| Export              | `GET /api/admin/systems/<id>/export`                                |
| Clone on export     | `GET /api/admin/systems/<id>/export?as=<new-id>&name=<name>`        |
| Retire              | `POST /api/admin/systems/<id>/retire`                               |
| Restore             | `POST /api/admin/systems/<id>/restore`                              |
| Delete              | `DELETE /api/admin/systems/<id>`                                    |
| Schema              | `GET /api/systems/schema` — open, since an author needs it          |

The upload limit is 25 MB by default and caps a fetched repository too; change it
with `DEVILS_TOYS_SYSTEM_LIMIT_MB`.

---

[← Rooms](rooms.md) · [Operating the server →](operating.md)
