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

**From a file.** A `.devilsystem.zip` exported from this or another server, or
built locally from a system repository with `npm run systems:bundle -- <repo>`.
This is useful while developing a system because it needs neither a push nor a
running server.

Installing is atomic. Open requests start using the new definition immediately
and no restart is needed; a bundle that fails any check leaves the previous
content and the previous registry entry exactly as they were.

## What a system may contain

Data, and nothing else:

- `devilsystem.json`, the marker saying which system this is, which version of it, and under what licence;
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

## Versions, and updating one

A system states its own version in `devilsystem.json`, beside its id and its
licences, and the installed list shows it next to the system's name. It is the
author's word about their own release — nothing derives it from a tag, a commit,
or a file's contents — so a system whose author never bumps it is a system that
never offers an update, which is the correct consequence of never releasing one.
A system that declares no version at all says **No version declared** rather
than showing a gap, because that is a fact about the system and not a panel that
failed to fetch something. Every system installed before versions existed is one
of those, and its rooms carry on exactly as they were.

When you open the panel, the server asks each installed system's repository what
version it is offering now. That is one small file per system — the repository's
own `devilsystem.json`, fetched over the allowlist above, from the host the
catalogue already comes from — rather than the whole system pulled down to read
six lines out of it. The answers are held for a few minutes, the same as the
catalogue's, so opening the panel twice does not ask twice; a repository that
would not answer is asked again on the next look rather than reported down until
that expires. Every answer is that system's own, so one unreachable repository
is one row saying so, and a check that fails entirely leaves the list exactly as
it would be without one.

There are seven answers, and most rows are meant to say nothing at all:

| The row                                                                                        | What it found                                                                         |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Update to 1.2.0**, on a button                                                               | The repository is offering a version that is provably later than the installed one.   |
| Nothing                                                                                        | The repository is offering what you already have. Most rows, most of the time.        |
| _"… is offering 0.9, which is neither the same as 1.1 nor provably later"_, with **Reinstall** | The two versions differ, but nothing here can say the upstream one is later.          |
| _"pinned to a commit"_, in the line that says where the system came from                       | The stored ref is a commit. Nothing was asked.                                        |
| _"nothing to update from"_, in that same line                                                  | The system was installed from a file, so there is no upstream. Nothing was asked.     |
| _"This system declares no version, so …"_, or the same about the repository                    | One side of the comparison, or neither, declares a version. The sentence names which. |
| _"That repository could not be read: …"_, marked as a warning                                  | The fetch failed, and the row carries the reason it gave.                             |

**A later version is claimed only where it is provably later.** Where both sides
read as dotted numbers they are compared as numbers, so `1.10` is correctly
later than `1.9`. Where either side does not, the honest answer is that the two
are _different_ rather than that one is newer: a version is whatever its author
wrote, and read as text rather than as numbers `2.0` looks later than `10.0`.
Such a row says so and offers **Reinstall**, which is what pressing the button
would actually do — including where the repository has gone backwards, since
going backwards is a reinstall and not an update.

**A pinned or file-installed system is told so rather than checked.** A commit
is immutable, so a check against one could only ever return what is already
installed; a system installed from a file has no upstream to ask at all, and
moves by installing another file. Neither opens a connection.

**Update installs.** It fetches from the same repository and ref the system
already came from and goes through every check a fresh install goes through, in
the same order, on the same files — so an update that would drop a sheet field
a character is still using is refused, and the system that is running, along
with its rooms, is left untouched. The log records what happened by name: the
version it moved from and the version it moved to.

### Breaking releases

A system author can declare that moving to a release needs manual attention and
write the reasons directly in `devilsystem.json`:

```json
{
  "formatVersion": 2,
  "version": "2.0.0",
  "breaking": true,
  "releaseNotes": [
    "Renamed the Resolve field to Will.",
    "Copy existing Resolve values before updating active characters."
  ]
}
```

The rest of the marker is unchanged; this abbreviated example shows only the
release fields. A breaking release must carry at least one plain-text note. A
non-breaking release may carry notes too, and leaving both fields out means the
ordinary, non-breaking case.

Installing a breaking release under a new system id is still a first install and
needs no acknowledgement. Replacing a different release under an id already on
the server opens a review dialog with the versions and every note. Nothing is
written until an administrator presses **Replace system**. The acknowledgement
is tied to the exact id, version, flag, and notes that were reviewed, so a branch
whose marker changes between review and retry must be reviewed again.
Reinstalling the identical accepted release does not ask twice.

Release metadata belongs to the marker and travels through repository imports,
bundles, stored manifests, and exports. Version-1 repositories and bundles remain
installable, but release warnings require format 2. That version boundary is
deliberate: an older application rejects format 2 instead of silently installing
a breaking release without showing its warning.

The catalogue menu is answered by the same check, so the menu and the installed
list cannot tell you two different things about one system. Where a system is
installed, what its repository says wins over what the catalogue entry says; the
entry's own version is the fallback for a system nobody has fetched yet, or for
a repository that would not answer.

**Nothing updates itself.** The server says a version exists. Installing it is a
button you press, when you choose to.

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

| Operation           | Request                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------- |
| List                | `GET /api/admin/systems`                                                                |
| Catalogue           | `GET /api/admin/systems/catalog`                                                        |
| Update check        | `GET /api/admin/systems/updates`                                                        |
| Import              | `POST /api/admin/systems/import` with `{id}` or `{repository, ref}`                     |
| Install from a file | `POST /api/admin/systems` — multipart, bundle in `bundle`                               |
| Update              | `POST /api/admin/systems/<id>/update`                                                   |
| Acknowledge         | Retry the install with `acknowledgeBreaking` set to the fingerprint returned by its 409 |
| Export              | `GET /api/admin/systems/<id>/export`                                                    |
| Clone on export     | `GET /api/admin/systems/<id>/export?as=<new-id>&name=<name>`                            |
| Retire              | `POST /api/admin/systems/<id>/retire`                                                   |
| Restore             | `POST /api/admin/systems/<id>/restore`                                                  |
| Delete              | `DELETE /api/admin/systems/<id>`                                                        |
| Schema              | `GET /api/systems/schema` — open, since an author needs it                              |

The upload limit is 25 MB by default and caps a fetched repository too; change it
with `DEVILS_TOYS_SYSTEM_LIMIT_MB`.

---

[← Rooms](rooms.md) · [Operating the server →](operating.md)
