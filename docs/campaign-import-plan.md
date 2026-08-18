# Campaign import

A plan for letting a GM prepare a campaign outside the application — as a zip of
labelled folders — and pour it into a room in one act.

A **system** is server-wide, admin-installed, and says what a game _is_: sheets,
statblocks, item lists, rulebooks. A **campaign** is room-scoped, GM-owned, and
says what a table is _playing_: maps, scenes, handouts, music, NPCs, encounters,
the shop's stock, the calendar the world runs on. A system is installed beside
other systems. A campaign is imported **into** one, and is refused by a room that
is not running it.

The two share their machinery and almost none of their policy. That split is the
whole design.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **The folder is the declaration.** `maps/`, `scenes/`, `references/`, `audio/`, `npcs/`, `encounters/` — a directory name says what its contents are. A zip holding nothing but `maps/*.png` imports without a manifest, without an index, without a GM having opened a text editor. This is the feature; everything else decorates it.                               |
| 2   | **Every JSON file is optional and only ever adds detail.** `manifest.json` names the campaign and its system. An `index.json` inside a folder gives display names, ordering, and visibility. A missing one means "derive it from the filenames". A malformed one is refused by name rather than ignored.                                                              |
| 3   | **Nothing inside a bundle references a database id.** An encounter names `maps/the-keep.png` and `npcs/lady-vane.json`; the importer resolves bundle paths to new rows in one pass. Ids in a zip are a lie the moment it leaves the machine that wrote it.                                                                                                            |
| 4   | **Import is preview, then commit.** The upload is staged and validated, and the GM is shown what would land — counts per kind, conflicts, and the megabytes against this instance's remaining allowance — before a single row is written. A campaign is large enough that "it turned out to be 340 MB" must not be discovered after.                                  |
| 5   | **A campaign is room content, so a room GM imports it.** Not a server admin as such — an admin reaches it the way they reach the rest of Room Config, through `requireRoomConfig`, as the GM of a room they can configure. Every byte it writes counts against the same upload allowance a hand-uploaded map does.                                                    |
| 6   | **A campaign declares its system and is refused by a room on another.** Item list keys, statblock fields, and hireling sheets are all system-shaped. The exception is deliberate: `system: "*"` marks a bundle carrying only system-agnostic content — maps, scenes, handouts, music, tables — and that one imports anywhere.                                         |
| 7   | **People, chat, and what is on screen never travel.** Accounts, memberships, invitations, characters, messages, private rolls, revealed references, map notations, and the active encounter are excluded by design. A campaign is prepared material, not a save file. Moving a room in flight is a different feature — see below.                                     |
| 8   | **The importer reads the directory, not the archive.** `readSystemBundle` holds a 130 KB archive whole, which is right for a system and wrong for a campaign. A campaign is staged to disk, its central directory is read for the entry list and sizes, and it is validated and refused in full before one byte is decompressed. See [Large bundles](#large-bundles). |
| 9   | **An import is recorded, so a bundle can be imported again.** Each created row is remembered against its bundle path. Re-importing a corrected or extended campaign updates what the last import made and leaves everything the GM has since made by hand exactly where it is. Without this, "chapter 2" means "delete and redo".                                     |
| 10  | **The export is the format's documentation.** A room exports itself as a bundle; that bundle imports into an empty room and produces the same room. The round trip is the acceptance test, as `monolith-2` was for systems, and it is what an author opens to learn the layout.                                                                                       |
| 11  | **A campaign never carries a system.** It may _require_ one by id, and the preview says "install Cairn first" when the server has not got it. Nesting an admin-scoped install inside a GM-scoped upload would hand every GM the systems panel.                                                                                                                        |

### Assumptions, flagged so you can overrule them

- **Room-scoped, not account-scoped.** A GM imports into a room they run. There is no library of campaigns held on the server between imports; a bundle is a file the GM keeps.
- **The zip is trusted for shape, not for content.** Zip-slip, entry counts, uncompressed size, file signatures, and UTF-8 validity are checked. A GM who uploads a 4,000-row NPC folder gets a slow import, not a refusal.
- **Table sets stay server-wide in v1.** `table_sets` has no `room_id` today, and giving it one is a schema change with its own consequences for the editor. A campaign's tables import as global sets, named and tagged for the campaign, and the preview says plainly that they land server-wide. See the open questions.
- **Conflicts are resolved per kind, not per file.** The preview offers one choice for the whole import — skip what exists, replace it, or add alongside — rather than a file-by-file interview. A GM importing a campaign wants to press one button.
- **No versioned migration of campaign data.** A bundle written by a newer `bundleVersion` is refused with its number, exactly as a system bundle is. Older ones are read.
- **Portraits ride with what they belong to.** Hirelings and group assets carry a picture; NPCs have no portrait column today and do not gain one here.

---

## What exists today

The plan has to work with these, not around them.

### The room's own content, and where it lives

Everything below is keyed by `room_id` and deleted with the room:

| Kind               | Where                                                      | Notes                                                                        |
| ------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Maps, scenes, refs | `media` + a UUID file under `<dataDir>/uploads/`           | `kind` is scene/reference/audio, `category` distinguishes a map from a scene |
| Handouts           | `media`, as `.md` — see `isMarkdownUpload` (`media.ts:36`) | Same table, validated as UTF-8 with no NULs                                  |
| Music              | `media` with `kind = 'audio'`, plus ID3 read on ingest     | `mp3-metadata.ts` fills artist/title/album                                   |
| Playlists          | `room_playlists`, `room_playlist_tracks`                   | An ordered view over the audio already in the room                           |
| NPCs               | `custom_npcs` (`statblock_json`, `notes`)                  | Validated against `systemOrThrow(system).npcStatblock.fields`                |
| Items and weapons  | `room_items`, `room_retired_items`                         | Ids are `room:<roomId>:<slug>`, minted by `roomItemId` (`room-items.ts:29`)  |
| Encounters         | `encounters`, `_sides`, `_zones`, `_combatants`            | Combatants are character, hireling, or npc, enforced by CHECK                |
| Hirelings, assets  | `group_hirelings`, `group_assets`, `group_obligations`     | Portrait columns in the shape `characters` carries them                      |
| Calendar           | `rooms.calendar_json` + `calendar_enabled`                 | One blob, schema in `calendar.ts:28`                                         |
| Room settings      | `rooms.name/theme/music_enabled/map_notation_enabled`      | What Room Config's switches write                                            |
| Tables             | `table_sets` — **server-wide, no `room_id`**               | `/rooms/:id/tables` serves `availableSets()` to every room (`tables.ts:178`) |

And what is emphatically session state rather than content: `room_state` (what is
on screen now), `revealed_references`, `map_notations`, `messages`,
`private_rolls`, `room_easter_eggs`, `encounters.active`.

### The precedents worth copying

- **`system-bundles.ts`** is the shape: a manifest with `app` and `bundleVersion`, a reader that refuses rather than half-installs, and `refuseUnsafePaths` — already exported, already generic, already documented as the check that must happen before a byte is written.
- **`system-install.ts:120`** stages under a sibling directory and renames into place. The campaign importer stages the same way, for the same reason.
- **`table-bundles.ts:204`, `compareToExisting`** already answers "new, identical, or conflict" per item and is exactly the preview's shape.
- **`installValidated` (`system-routes.ts:102`)** puts everything that can fail before anything is written, and says so in a comment. Copy the order, not just the idea.
- **`media.ts`** owns file-type policy: `imageTypes`, `validImageSignature`, `validMarkdownFile`, `storedUploadBytes`. The importer calls these; it does not restate them.
- **`repository-table-import-script.ts`** is the confirm-before-writing precedent, and the reason a GM will already recognise the preview.

### What is missing

- **No streaming unzip.** `fflate`'s `unzipSync` is what both existing readers use. `fflate` also exports `Unzip`, a streaming reader, which is what a media-carrying bundle needs.
- **No ledger of what an import created.** Nothing in the schema can answer "did this row come from a bundle, and which one".
- **No room-scoped table sets.** Noted above; carried as an open question rather than solved here.

---

## The bundle

```text
tomb-of-the-serpent-kings.devilcampaign.zip
├── manifest.json              app, bundleVersion, campaign id/name/version, system, licenses
├── campaign.md                the GM's overview — shown at import, kept as a handout
├── room.json                  name, theme, and switches: advisory, applied only on request
├── calendar.json              a RoomCalendar, as calendar.ts validates it
├── maps/
│   ├── index.json             optional: display names, order, category overrides
│   ├── the-keep.png
│   └── the-under-halls.webp
├── scenes/
│   └── the-black-gate.jpg
├── references/
│   ├── the-baron's-letter.md
│   └── heraldry.png
├── audio/
│   ├── index.json             optional: artist/title/album overrides
│   └── dirge.mp3
├── playlists/
│   └── combat.json            { name, sortOrder, tracks: ["audio/dirge.mp3", …] }
├── npcs/
│   ├── lady-vane.json         { name, notes, statblock: { … } }
│   └── serpent-priest.json
├── encounters/
│   └── the-gate.json          { name, notes, map: "maps/the-keep.png", zones, sides, combatants }
├── items/
│   ├── index.json             { added: [ … ], retired: ["cairn/torch"] }
│   └── …
├── hirelings/
│   └── brann.json             { name, sheet: { … }, portrait: "hirelings/brann.png" }
├── assets/
│   └── the-kestrel.json       { kind: "starship", name, sheet: { … } }
└── tables/
    └── rumours.json           a table set, in the shape table-bundles.ts already writes
```

Three rules make this work, and they are the whole of the format:

1. **A folder's name decides what its files are.** An unknown top-level folder is refused by name — a typo'd `map/` must be an error, not a silent omission of every map in the campaign.
2. **A media folder may hold nothing but media.** `index.json` is the one exception, and everything in it is optional; an entry naming a file the folder does not hold is refused.
3. **A data folder holds one JSON per entity**, named by the entity, and cross-references are bundle paths. `encounters/the-gate.json` naming `npcs/lady-vane.json` is the only way an encounter can know an NPC.

### `manifest.json`

```json
{
  "app": "devils-toys-campaign",
  "bundleVersion": 1,
  "campaignId": "tomb-of-the-serpent-kings",
  "name": "Tomb of the Serpent Kings",
  "version": "1.2",
  "system": "cairn",
  "exportedAt": "2026-08-16T00:00:00.000Z",
  "licenses": ["CC BY-SA 4.0"]
}
```

`campaignId` is what decision 9 hangs on: it is the identity that survives between
a bundle and its successor, and it is what the ledger keys on. `system` is a
registry id or `"*"`. Everything else is for the preview and the credits.

A bundle with **no** `manifest.json` is still read: `app` is assumed, the campaign
is named after the file, the system is taken as `"*"`, and the preview says which
of those it guessed. A GM who has dragged four folders together should not be
stopped by a JSON file they have never heard of.

### Cross-reference resolution

One pass, in dependency order, holding a map from bundle path to new row id:

```text
media (maps, scenes, references, audio)
  → playlists      (tracks name audio paths)
  → npcs           (independent, but resolved before encounters need them)
  → encounters     (map names a media path; combatants name npc and hireling paths)
hirelings, assets, obligations
items, calendar, room settings, tables
```

A reference that does not resolve is refused during validation, before the write —
`encounters/the-gate.json names npcs/serpent-king.json, which the bundle does not
contain.` The importer never invents a placeholder and never drops a combatant
quietly.

### What the importer mints rather than carries

- **Stored filenames.** A `media.stored_name` is a fresh UUID with the extension the type implies, exactly as an upload gets. The bundle path becomes `filename`; `index.json` may set `display_name`.
- **Room item ids.** `roomItemId(roomId, name, spec)` against the destination room, because a `room:<roomId>:` id is only true of the room that minted it.
- **Every primary key.** Nothing in a bundle is written into an `id` column.
- **`encounters.active = 0`.** An imported encounter is prepared, never running.

Retired item ids are the one thing carried verbatim, because they name a system's
items rather than a room's. Ones the destination system does not have are reported
in the preview and skipped — a Cairn campaign's retired torch means nothing to a
room running Monolith, and this is one of the ways a mis-targeted bundle announces
itself.

---

## Import, end to end

### 1. Upload and stage

`POST /api/rooms/:roomId/campaign/stage`, multipart, behind `requireRoomConfig`.
An uploaded zip is the only way a campaign gets in: no path on the server may be
named, and nothing is fetched. That is one route to defend rather than two, and it
keeps the feature reachable by the person whose room it is, from wherever they are.

The upload goes to disk through `multer.diskStorage` — as `media.ts` already does
for every map a GM uploads by hand — and is never held in memory. Then its
**central directory** is read, which is what makes the rest of the checks cheap:

- `refuseUnsafePaths` on every entry name, reused as-is.
- The top-level folder allowlist, so a typo'd `map/` is refused from the listing rather than after an extraction.
- An entry-count cap, a per-file cap matching the kind's existing limit (`sceneImageUploadLimitMb` for a map, `audioUploadLimitMb` for a track), and the uncompressed total against `config.campaignUploadLimitMb`, the instance's remaining allowance from `storedUploadBytes()`, and the free space under `dataDir` from `fs.statfs`.

All of that is answered before a byte is inflated. Only then are entries expanded
into `<dataDir>/imports/<token>/`, one at a time, against a **real** running byte
counter — a directory's declared sizes are a claim, not a fact, and a zip bomb
lies in exactly that field. `validImageSignature` and `validMarkdownFile` run per
file as it lands, so a `.png` that is not one never reaches the uploads directory.

The staging directory carries the token, the room, the account, and a timestamp. A
reaper removes anything older than the TTL on start and on each stage, so an
abandoned upload is not a permanent tenant.

**The cap is never a dead end.** With one door, the refusal has to carry the way
past it or a GM is simply stuck, so it names the split by name:

> This campaign is 2.4 GB, and the upload limit is 2 GB. Split it into parts that
> share a `campaignId` — the maps in one, everything else in another — and import
> them one after another.

That route needs no admin, no shell, and no second feature. It is the reason
multi-part campaigns are not a nicety.

### 2. Preview

`GET /api/rooms/:roomId/campaign/:token` returns what would happen — never a
partial write, and nothing outside the staging directory has been touched:

```json
{
  "campaign": { "name": "Tomb of the Serpent Kings", "version": "1.2", "system": "cairn" },
  "systemMatch": "exact",
  "overview": "…campaign.md, rendered…",
  "bytes": { "incoming": 356515840, "remaining": 1073741824 },
  "kinds": [
    { "kind": "maps", "new": 12, "identical": 0, "conflict": 1, "skipped": 0 },
    { "kind": "npcs", "new": 34, "identical": 0, "conflict": 2, "skipped": 0 },
    { "kind": "tables", "new": 3, "identical": 0, "conflict": 0, "scope": "server-wide" }
  ],
  "warnings": [
    "items/index.json retires \"cairn/lantern\", which this system does not have.",
    "room.json names the theme \"ember\", which this server does not have. The room keeps its own."
  ],
  "previousImport": { "campaignId": "tomb-of-the-serpent-kings", "version": "1.1", "importedAt": "…" }
}
```

`systemMatch` is `exact`, `agnostic`, or `mismatch`; a mismatch is a refusal with
both ids named, not a warning. `previousImport` is what turns the confirm dialog
from "import" into "update from 1.1 to 1.2".

### 3. Confirm

`POST /api/rooms/:roomId/campaign/:token/apply` with the conflict policy and the
opt-ins — whether to take `room.json`'s name and theme, whether to take the
calendar, whether to import the tables server-wide.

The whole write is one transaction over the database. Files move into `uploads/`
**before** it opens and are removed on rollback, which is the same trade
`media.ts` already makes with `removeUploaded`: a stray file is recoverable, a row
pointing at a missing one is not.

They _move_ rather than copy. Staging and uploads are both under `dataDir`, so
`fs.renameSync` is a directory operation rather than a gigabyte of I/O, and it is
atomic — which is what lets the commit of a large campaign be instant and its
rollback be a rename back. A `dataDir` spanning a mount point raises `EXDEV`; that
one case falls back to copy-and-unlink.

On success the room is broadcast to over `broadcastRoom` so every open client
picks up the new library, and the staging directory is removed.

### 4. The ledger

```sql
CREATE TABLE IF NOT EXISTS room_imports (
  id INTEGER PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  manifest_json TEXT NOT NULL DEFAULT '{}',
  imported_by INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS room_import_entries (
  import_id INTEGER NOT NULL REFERENCES room_imports(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  row_id INTEGER NOT NULL,
  digest TEXT NOT NULL,
  PRIMARY KEY (import_id, kind, path)
);
```

`digest` is what the importer wrote, so a second import can tell three cases
apart that a name comparison cannot: unchanged in both (skip), changed in the
bundle only (update), and changed in the room since the import (a real conflict,
and the only one worth asking about). It is also what makes "remove this
campaign's contribution" answerable later, which is a feature this plan does not
build but must not foreclose.

Entries are keyed by bundle path rather than by name, so renaming a map in the
bundle is a delete plus an add — honest, and cheaper than guessing.

---

## Large bundles

A campaign's size is entirely its media. The JSON and Markdown of a fat campaign —
two hundred NPCs, forty encounters, a year of calendar events — is a few hundred
kilobytes. A hundred maps and forty music tracks is a gigabyte. So "how large can
a bundle be" is really "how many pictures and how much music", and every measure
below is aimed at that and at nothing else.

### The four ceilings, in the order they are hit

1. **The reverse proxy.** nginx's `client_max_body_size` defaults to **1 MB**. A campaign import fails here first, before any code in this repository runs, with a 413 that says nothing useful. This belongs in `docs/deployment.md` on the day Phase 3 lands.
2. **Memory.** `unzipSync` takes the whole archive as one `Uint8Array` and returns every entry decompressed beside it. Node 22 will not stop you; a 1 GB campaign becomes something over 2 GB resident, which on a small VPS is an OOM kill rather than an error message.
3. **Disk.** Staged bytes plus imported bytes is 2× the campaign, transiently.
4. **Time.** A gigabyte of extraction and a few thousand inserts is minutes. An HTTP request that takes minutes is a request that a proxy, a laptop lid, or an impatient GM will end halfway.

### What handles them

**Read the directory, not the archive.** A zip records every entry twice: once in
a local header before its data, and once in the central directory at the end of
the file, which carries each entry's name, compressed size, uncompressed size, and
method. Reading the tail of a staged file — the End of Central Directory record,
then the directory it points at — answers every question the preview asks, for two
seeks and no decompression, at any archive size. It is about eighty lines against
a fixed, well-specified layout, it is pure, and it is the single most valuable
piece of this feature's plumbing.

The temptation is to reach for `fflate`'s streaming `Unzip` instead. It is the
wrong tool here: it is a push parser over local headers, so it learns what is in
an archive by reading all of it, and the thing wanted is the opposite — the whole
plan before any of the bytes. (`unzipSync` does accept a `filter` that receives
exactly the per-entry directory information and skips decompression when it
returns `false`, which is a genuinely good trick — but it still wants the entire
archive as one buffer, so it stays the **system** importer's tool.)

**Move the bytes once.** Rename out of staging into `uploads/`, per the commit step
above. A gigabyte campaign commits in milliseconds.

**Refuse early, with arithmetic.** The allowance and free-space checks happen at
the directory read, seconds after the upload finishes and before any work: _"This
campaign needs 1.2 GB. This instance has 340 MB of its allowance left, and 3.1 GB
of disk."_ A GM should learn a campaign will not fit before making tea.

**Do not compress what is already compressed.** On export, PNG, JPEG, WebP, and MP3
entries go in through `ZipPassThrough` (stored, level 0); JSON and Markdown keep
deflate. Deflating a JPEG spends the CPU of the whole export to save nothing.

**Make the apply a job, not a request.** It returns a job id immediately, reports
progress over the WebSocket the room already holds, and takes a per-room import
lock so two of them cannot interleave. The preview stays a plain request, because
after the above it is a directory read and it is fast.

### And the one that means nobody has to upload a gigabyte

**Multi-part campaigns.** Bundles sharing a `campaignId` compose, in any order:
`tomb-core.zip` at 400 KB with every NPC, encounter, item, and table, and
`tomb-art.zip` at 1.2 GB with the pictures — or that second half split again, into
four zips of three hundred megabytes that each upload without drama. The ledger
already keys on `campaignId`, so this costs almost nothing to allow.

With the upload as the only door, this stops being a distribution convenience and
becomes the pressure valve: it is what a GM does when a campaign will not fit
through it, and it is what the size refusal points them at. It also happens to be
what makes a campaign _shareable_ — the half that matters is small enough to
email — but that is the lesser reason now. It should be built no later than the
cap it relieves.

### And two that shrink the problem

**Digest-skip on re-import.** The ledger records a SHA-256 per media file, so
re-importing a corrected campaign moves only what changed — usually nothing. One
caution: this must stay a decision about whether to _write_, not an invitation to
point two `media` rows at one stored file. Deleting a media row removes its file
today, and sharing files means refcounting them, which is a different change.

**Media-optional bundles.** An `index.json` may name a file the bundle does not
carry. The preview lists it as missing, the room takes it later, and a campaign
that cannot redistribute its art ships as text.

### The one to leave alone

Resumable chunked upload, for now. It is the most machinery here by some distance,
and multi-part campaigns cover the same ground at a fraction of the cost — a GM
who splits a campaign gets restartable imports as a side effect, because a part
that fails is re-uploaded on its own.

But it is worth being honest that it is now the only thing left if uploads
themselves prove unreliable — a two-hour upload over a domestic connection that
dies at ninety minutes is not fixed by any of the above. The stage token is the
right seam for it, and it stays out of v1 on cost rather than on principle. If it
is ever needed, it is a change to how bytes arrive and to nothing else.

### Numbers to start from

| Limit                   | Value                          | Why                                                                 |
| ----------------------- | ------------------------------ | ------------------------------------------------------------------- |
| Per image               | `sceneImageUploadLimitMb` (60) | Unchanged — a big campaign is big by count, not by one monster      |
| Per track               | `audioUploadLimitMb` (50)      | Unchanged, same reason                                              |
| Entries                 | 5,000                          | A campaign with more is a mistake worth naming                      |
| `campaignUploadLimitMb` | 2048                           | Whole-archive cap; the refusal names the split                      |
| Staging TTL             | 24 hours                       | Long enough to preview, decide, and come back after a night's sleep |

## Export

`GET /api/rooms/:roomId/campaign/export`, GM-gated, streaming a zip in exactly the
layout above. It is the same content selection read backwards, and it settles the
format the way decision 10 says.

Two things it must get right:

- **Filenames are slugged from display names and deduplicated**, the way `slugFor` in `table-bundles.ts:39` already does it. A room with two maps called "The Keep" exports as `the-keep.png` and `the-keep-2.png`.
- **A room's exported bundle re-imports into an empty room and produces the same room.** That equality — media by content and metadata, NPCs by name and statblock, encounters by structure — is the round-trip test.

Tables are the exception: a room's exported campaign carries only sets tagged for
that campaign, because everything in `table_sets` is visible to every room and
exporting the lot would be a surprise.

---

## Work

### Phase 1 — Archive plumbing — **done**

Lift the safety checks out of `system-bundles.ts` into a `zip-safety.ts` both
readers use — `refuseUnsafePaths` moves as-is, and the caps become parameters.
Add the central-directory reader over a staged file, and the entry-at-a-time
extraction against a real byte counter. No routes, no schema. Tests: an entry
escaping the directory, a bomb whose directory understates it, an over-budget
archive, a truncated zip, and one with no End of Central Directory record at
all — each refused for its own reason.

### Phase 2 — Manifest, reader, and preview — **done**

`campaign-bundles.ts`: the manifest schema, the folder allowlist, the per-folder
readers, and the cross-reference resolver — all over a staged directory, all
pure, all refusing with a message naming the file. The stage and preview routes,
the staging reaper, and `config.campaignUploadLimitMb`. Nothing writes to the
database yet, which means the preview is testable on its own and is the first
thing that can be demonstrated.

One departure from what this said when it was written, which is worth recording
rather than absorbing: the **data-kind readers move to the phases that write
them**. Reading `npcs/` months before anything can import an NPC would be code
with no caller and no test that exercises what it is for, and Phase 4 already
described each kind as "a small reader and a small writer" — those two halves
belong in one change. What Phase 2 owns is the frame every kind hangs off: the
manifest, the folder allowlist, the listing checks, the `index.json` convention,
and cross-reference resolution, with the media folders as the first kind read
through all of it.

A folder whose reader has not landed yet is still accepted from the archive and
reported in the preview as pending. That is the honest state of a feature built in
phases, and it is the opposite of the failure this format must not have: a bundle
that appears to import and quietly drops half of itself.

### Phase 3 — Media, handouts, and playlists — **done**

The byte movers and the simplest data. Maps, scenes, references, audio, and the
playlists over them, through the existing type policy — which is called rather
than restated: `imageSignatureMatches`, `isUtf8Markdown`, and `isMp3File` moved
to take a path so an imported file is held to exactly what a hand-uploaded one
is. `docs/deployment.md` gains the `client_max_body_size` section on the same
day, because a feature whose first failure mode is a proxy default is not shipped
until that is written down. At the end of this phase a map pack is a working
feature — a `system: "*"` bundle of images imports into any room.

**The apply does not become a job, and this plan was wrong to say it would.** The
reasoning was that this is the phase where importing stops being fast. It is not:
expansion happens at staging, and the commit is renames within one filesystem plus
one insert per file, so a gigabyte costs the same syscalls as a megabyte and
finishes in milliseconds. Whatever wants progress reporting is the **staging**
request, whose cost is the upload — and that can wait until somebody actually
stages a gigabyte and finds out whether it needs it. Building a job queue to watch
an operation that is already instant would have been machinery in the shape of a
plan rather than in the shape of the problem.

### Phase 4 — NPCs, items, calendar, group content — **done**

Statblocks validated against the room's system, item ids minted for the room,
retired ids checked against the catalogue, the calendar through `calendarSchema`,
and hirelings, assets, and obligations with their portraits. Each one is a small
reader and a small writer against a table that already exists.

### Phase 5 — Encounters — **done**

Last of the content because it is the only kind that references three others.
Sides, zones, and combatants; NPC and hireling combatants resolved through the
same path map or refused. `active = 0` on everything, so a bundle landing
mid-session cannot put a fight on everybody's screen.

Two things the writing settled. **Characters do not travel** — a campaign carries
no people, so a combatant is an NPC or a hireling and the schema will not accept
anything else. And an encounter is **never replaced**, whatever conflict policy
the import runs under: one in progress carries hit points, initiative, and
positions that a re-import has no way to know about, and losing those mid-fight
would be the worst thing this importer could do. It is skipped by name instead.

### Phase 6 — Tables — **done**

Import a campaign's sets through the existing table-set writer, named for the
campaign — "Tomb of the Serpent Kings — Rumours" — and flagged server-wide in the
preview, because this is the one kind that reaches past the room a GM was
configuring.

Tags keep the standing rule: an unknown slug is refused rather than dropped. The
refusal costs **that set** rather than the whole campaign, though, because a tag
this server has not heard of says nothing about the forty maps in the same
bundle. That is the same shape Phases 4 and 5 settled on for everything the
destination cannot hold — land the rest, name the loss.

With this phase every folder the format declares has a reader, so the "pending"
machinery that reported the ones that did not is gone rather than left as a
constant empty list. The test that covered it became one that reads a bundle
carrying one of everything, which is the check that keeps a folder from being
added to the allowlist without a reader behind it.

### Phase 7 — The ledger and re-import

`room_imports` and `room_import_entries`, digests written on the way in, and the
three-way comparison on the second import. Deliberately after a working import:
the ledger is what makes the feature good, not what makes it work.

### Phase 8 — Export and the round trip

The export route, the slugging, the stored-not-deflated entries for media, and
the round-trip test that is this plan's acceptance.

### Phase 9 — The UI and the guide

A **Campaign** section in Room Config: drop a zip, read the preview, choose the
policy, confirm, and a record of what was imported and when. On the room list, a
"from a campaign bundle" path on room creation, which reads `room.json` for the
name, theme, and system, makes the room, and runs the import into it. Then
`docs/guide/gm/campaigns.md`, and a paragraph in the GM's Guide index.

---

## Testing

- **Reader tests, in the shape of `system-bundles.test.ts`**: every refusal asserted on its own reason. Unknown folder, `index.json` naming a missing file, an unresolved cross-reference, a system mismatch, a newer `bundleVersion`, a `.png` that is not one, a handout with a NUL byte.
- **Preview tests**: the same bundle against an empty room and against a populated one, asserting new/identical/conflict per kind and the byte arithmetic against `storedUploadBytes()`.
- **Write tests**: a failed write leaves no rows and no files — assert both, since the two halves roll back by different mechanisms.
- **Ledger tests**: import 1.1, edit one NPC in the room by hand, import 1.2, and assert the hand edit survives while an untouched NPC updates.
- **Round trip**: build a room through the API, export, import into a fresh room, and compare. This is the acceptance test; it belongs in `server/src`, not in e2e, so it runs on every change.
- **A fixture bundle** beside `fixtures/plainbox` and `fixtures/toybox` — small, ugly on purpose, holding one of everything including the awkward cases.
- **One e2e spec**: upload, preview, confirm, and see a map appear in the library, in the shape `e2e/calendar.spec.ts` already has.

---

## What this does not do

- **It is not a room backup.** No accounts, characters, chat, or session state. The roadmap's "export/import of a single table, including characters and players" is a different feature with a different threat model — it moves people between servers, and that needs answers about account matching this plan does not have. The two should share `zip-safety.ts` and nothing else.
- **It does not merge two campaigns.** Importing a second bundle into a room adds to it; nothing reconciles two campaigns' NPCs.
- **It does not remove a campaign.** The ledger makes that answerable later; the route is out of scope.
- **It does not install a system**, per decision 11.
- **It does not publish or fetch campaigns.** No catalogue, no repository import, no outbound connection. A bundle is a file a GM has. If that changes, it reuses `system-sources.ts` and its host allowlist rather than growing a second fetcher.

---

## Open questions

1. **Do a campaign's tables stay server-wide?** Shipped as server-wide, since that is what `table_sets` can express today: it has no room, and a set added by anybody is readable from every room. The alternative is `table_sets.room_id`, nullable, with a room seeing global sets plus its own — the right shape, touching the editor, its permissions, and its bundles. Nothing in Phase 6 forecloses it: the campaign name in the set's title becomes redundant rather than wrong, and the preview's warning goes away. Still worth deciding before a server accumulates a hundred imported sets nobody can tell apart.
2. **Should a campaign be able to carry pre-made characters?** Pre-generated PCs are a real thing a published adventure ships. They would import into the character pool unowned, for a GM to assign — which is a mechanism `accounts.md` already describes for handing a character to a player. It is a small addition and it is the one exclusion in decision 7 I am least sure of.
3. **How large may a campaign be?** [Large bundles](#large-bundles) proposes 2 GB, and argues the number matters less than it looks once the directory is read first. It wants an opinion from whoever runs the largest instance — and, since the upload is the only door, the multi-part split has to be built before the cap can be trusted to be a limit rather than a wall.
4. **Should `room.json` be applied at all on import into an existing room?** Taking a bundle's theme and renaming a running room is startling. The plan makes both opt-in checkboxes, off by default, and applies them without asking only on the create-a-room-from-a-bundle path.
5. **Does a campaign declare a system version?** It can name `system: "cairn"` today. Naming a minimum version means the preview can say "this campaign expects Cairn 1.2, this room has 1.0" — but nothing in the registry records a system version except a repository-installed system's manifest, so it would be advisory at best.
