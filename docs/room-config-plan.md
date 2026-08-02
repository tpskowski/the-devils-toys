# Room Config

A plan for the GM control panel: a second full-page surface, opened in its own tab from the rail's **Manage** section, where a GM edits everything a room owns without a modal in the way.

It **adds to** the game UI rather than replacing it. Every control that exists in a room today keeps working exactly as it does. Room Config is the wide, unhurried version of the same jobs — the place to do twenty of something, not one.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | It is a **route in the existing game client** (`/config`, `/config?room=<id>`), code-split so nobody who never opens it downloads it. Not a third application, not a third process.                                                                                                     |
| 2   | Access is **one gate in one module**, `server/src/room-config-permissions.ts`: an admin reaches any room, a GM reaches rooms where their membership role is `gm`, a player reaches none. `roomRole` is **not** widened — every existing route keeps meaning what it means today.        |
| 3   | An admin editing a room they do not belong to is an **observer with write access**, not a member: they never appear in presence, never post chat, and are not counted as being in the room.                                                                                             |
| 4   | Weapon and item lists become a **per-room overlay** on the system catalogue — added items and retired ids in the database. `systems/<id>/items.json` stays the authority for the system and is never written at runtime.                                                                |
| 5   | **Hirelings, group assets, and obligations stop living inside `room_state.group_json` and become rows**, each carrying its own `sheet_json` exactly as `characters` does. This is a prerequisite for the panel, not a side effect of it — and it pays for itself well beyond this page. |
| 6   | The panel **sets things up; the room runs them.** It builds the calendar and edits the playlists; advancing the clock and pressing play stay where the game is. Enable switches live here because enabling is setup.                                                                    |
| 7   | Playlists are **new**: named, ordered lists of the room's audio. Today there is one flat audio library and one playback state. This is what "add combat music" on the roadmap needs.                                                                                                    |
| 8   | Group assets are **driven by the system definition**, not by a list of asset kinds written into the panel. Starships ship because Monolith declares `starshipSheet`; strongholds appear the day a system declares them, with no panel change.                                           |
| 9   | Every write goes through the **existing route or a sibling beside it**, so the same validation, the same broadcast, and the same storage rule applies whether the edit came from the room or from the panel. No section gets a private back door to a table.                            |

### Assumptions, flagged so you can overrule them

- **The room selector lists archived rooms too**, marked. Archiving is how a room is retired, and retiring one is exactly when you want to go tidy it up.
- **One panel, many rooms, no cross-room editing in v1** beyond an explicit "copy to…" on NPCs and items. The room switcher swaps context; it does not put two rooms on screen.
- **Desktop-first, per `AGENTS.md`.** It reflows to a single column on a phone and stays usable, but it is not designed for one.
- **An admin's edit is logged as theirs** and otherwise indistinguishable from the GM's. There is no "acting as GM" mode.

---

## What exists today

The plan has to work with these, not around them.

- **The rail's Manage section** is `client/src/App.tsx:393-445`, shown when `canManage` (`account.role !== "player"`). It already holds "Players & characters" (in-page) and "The Devil's Tables" (new tab, external port). Room Config is a third entry: new tab, same origin.
- **A standalone page in its own tab already exists.** `client/src/main.tsx` switches on `rulesSystemFromPath(location.pathname)` to render `RulesReferencePage` instead of `App`, with paths built by `rulesPath(system, roomId)` → `/rules/<system>?room=<id>` (`client/src/rules.ts`). Room Config copies that shape exactly. The server needs no route: `index.ts:796` already serves `index.html` for any unmatched path.
- **Room access is `roomRole(accountId, roomId)`** returning `gm | player | undefined` from `memberships`. Every GM route in `media.ts`, `npcs.ts`, `audio.ts`, `group.ts`, `npcs.ts`, and `index.ts` compares against `"gm"` inline. An **admin who is not a member has no role at all** and today can reach nothing in the room except `DELETE /api/rooms/:roomId`.
- **`server/src/table-permissions.ts` is the model to copy** — three named gates, one module, and `AGENTS.md` says to put a new route behind one rather than write another role check.
- **Library** is the `media` table (`kind` scene/reference/audio, `category` map/scene/reference/audio, `visible`) plus `room_state.map_id` / `scene_id`, served by `mediaRouter`. Reveals are per-account rows in `revealed_references`. There are no tags and no bulk operations.
- **NPCs** are two things: `custom_npcs` rows (name, notes, `statblock_json`) and the rulebook bestiary parsed by `npcCatalog(system)` from each system's `npcCatalog: { heading, entryLevel, exclude }`. `POST /rooms/:id/npcs/from-catalog` turns the second into the first, and `clone` copies within a room.
- **Items** come from `systems/<id>/items.json`, esbuild-inlined into the server bundle, reaching the client through `characterItemsFor(system)` at exactly **two call sites**: `characters.ts:195` and `group.ts:201`. `AGENTS.md` is explicit that the catalogue is the authority and hand-edited; it is also read-only at runtime in the container.
- **Calendar** is `rooms.calendar_enabled` and `rooms.calendar_json`, with `PUT /rooms/:id/calendar` guarded by a **`revision` check that returns 409** on a stale write — the only optimistic-concurrency story in the codebase, and the one to imitate.
- **Audio** is `media` rows with `kind = 'audio'` plus a single `room_state.audio_json` playback state (`trackId`, `playing`, `position`, `repeat`, `shuffle`). There is **no playlist concept and no track order**.
- **Hirelings, ships, and obligations share one blob**: `room_state.group_json`, an untyped `Record<string, unknown>` capped at 250 KB by `groupStateSchema`, holding `state.hirelings[]`, `state.starships[]` (legacy singular `state.starship`), `state.obligations[]` (legacy `state.groupDebt` string), and the group's own definition-driven fields, all at once. Identity is a **string id minted client-side**, defaulting to `hireling-<n>` by array position when one is missing.
- **Everything pointing at a hireling points at that string.** `hireling_images` and `starship_images` are keyed by `(room_id, <thing>_id TEXT)` with no foreign key. `encounter_combatants.hireling_id` is a `TEXT` column with no foreign key, kept honest by a `CHECK` and a partial unique index, and resolved by `hirelingFromState()` scanning the blob (`encounters.ts:256`). Deleting a hireling has to hand-delete its image row and its combatant rows in a transaction (`group.ts:295`).
- **The blob's concurrency story is a whole-document `updated_at` 409**, plus a guard that refuses any PATCH which would drop a hireling — "Remove hirelings through the dedicated delete route" — because a stale blob write would otherwise silently delete one. `updateHireling()` exists solely to merge one entry inside `BEGIN IMMEDIATE` rather than rewriting the document.
- **`characters` is the counter-example, and the model to copy**: a real row with an `id`, an owner, a `portrait_*` set of columns, and a `sheet_json` blob holding only that character's own definition-driven sheet.
- **Realtime** is coarse: `broadcastRoom(roomId, { type })` with `media-updated`, `npcs-updated`, `group-updated`, `audio-updated`, `audio-playback`, `calendar-updated`, `room-updated`, `characters-updated`, `encounters-updated`. Clients refetch on receipt. Sockets join by `roomRole`, so **an admin non-member cannot subscribe today**.
- **New tables need no migration** — `db.ts` runs `CREATE TABLE IF NOT EXISTS` on every start. Only a **column added to an existing table** needs the `hasColumn` guard, and only a changed constraint needs the rooms-style rebuild.

---

## Access

One module, `server/src/room-config-permissions.ts`, in the shape of `table-permissions.ts`:

```ts
/** Who may open a room's configuration, and on what footing. */
export type RoomConfigAccess = "gm" | "admin";

export function roomConfigAccess(account: AuthAccount, roomId: number): RoomConfigAccess | undefined;

/** Route gate: resolves and validates :roomId, or answers 403/404 and returns undefined. */
export function requireRoomConfig(req: AuthedRequest, res: Response): number | undefined;

/** The rooms this account may configure, for the selector. */
export function configurableRooms(account: AuthAccount): ConfigurableRoom[];
```

The rule, stated once:

- **Player** — no access, at any level, to any room. `403`.
- **GM** — access where `roomRole(account.id, roomId) === "gm"`. A GM's own player memberships give nothing; being a `gm`-role account is not enough on its own.
- **Admin** — access to every room that exists, member or not.

Three things this must not do:

1. **Not widen `roomRole`.** Making it return `"gm"` for admins would silently hand admins GM presence, GM chat visibility, GM-only broadcasts, and GM roll privacy in every room on the server. The gate is additive and lives only on config routes.
2. **Not leak room existence.** A GM asking about a room they do not GM gets the same answer as one asking about a room that does not exist — `404`, matching how `media.ts` and `group.ts` already behave.
3. **Not make the admin a member.** `realtime.ts` gains the ability to accept a config subscriber (below), but `roomMembers()` and `publishPresence()` keep reading `memberships` and are not touched.

**Realtime for admins.** `realtime.ts` currently refuses a socket for a room the account has no membership in. It gains one narrow allowance: a socket that identifies itself as a config subscriber may join when `roomConfigAccess` allows, and is then **send-only from the server's point of view** — it receives `*-updated` events, is excluded from `publishPresence`, `publishPresenceNotice`, and every player-facing broadcast, and any inbound message on it is dropped. A GM configuring their own room needs none of this; it exists so the admin's panel is not stale.

---

## The shell

```
/config                → room selector
/config?room=<id>      → that room, section remembered per room in localStorage
/config?room=<id>#npcs → deep link to a section
```

- `client/src/room-config.ts` — `roomConfigPath(roomId?)`, `roomConfigTarget(pathname, search)`, section slugs, with a unit test beside it. Mirrors `client/src/rules.ts` and `rules.test.ts`.
- `client/src/main.tsx` gains a third branch. The panel is `lazy()`-imported inside a `<Suspense>` so its chunk is only fetched on `/config`; players never pay for it.
- `client/src/RoomConfigPage.tsx` — the shell: room switcher, section list, section body, save/error/notice strip. Themed by the selected room's theme, the same `theme-<id>` class the workspace uses.
- **The rail link** goes beside The Devil's Tables in `App.tsx`, `<a target="_blank" rel="noreferrer">`, `href={roomConfigPath(activeRoomId)}` — carrying the current room when there is one, bare when there is not. Same-origin and always available, so it needs none of the "is it running?" probing the tables link does.

Sections are filtered per room before they are drawn:

| Section      | Shown when                                  |
| ------------ | ------------------------------------------- |
| Library      | always                                      |
| NPCs         | always                                      |
| Items        | always                                      |
| Calendar     | `room.calendarEnabled`                      |
| Playlists    | `room.musicEnabled`                         |
| Hirelings    | system declares `groupPage.hirelings`       |
| Group assets | system declares any `groupPage` asset sheet |

A disabled feature shows the section greyed with its enable switch, rather than vanishing — the panel is where you would go looking for it.

---

## The seven sections

### 1. Library assets

**Reuses** `mediaRouter` wholesale. The panel is a table, not a grid of cards: name, kind, category, size, visibility, whether it is the active map or scene, upload date, uploader.

New capability, and the only new server work here:

- **Bulk actions** — `PATCH /rooms/:id/media/bulk` taking `{ ids, category?, visible? }` and `DELETE /rooms/:id/media/bulk` taking `{ ids }`, both validating every id belongs to the room before touching any, both emitting a single `media-updated`. Deleting audio must reuse the existing file-removal path and additionally drop the tracks from any playlist.
- **Search and filter** across name, filename, kind, category — client-side; a room's library is not large enough to page.
- **Rename in place**, already `PATCH /rooms/:id/media/:mediaId`.
- **Orphan report** — references never revealed, audio in no playlist, uploads not used as map or scene. Read-only, informational.
- _Phase 2, optional:_ `media.tags_json` for library organisation. This is a column on an existing table and so needs the `hasColumn` migration guard.

Reveals stay in the room. Revealing a reference to a player is a live act.

### 2. NPCs

**Reuses** `npcRouter`. The panel gives the bestiary and the room's NPCs one screen: catalogue on the left, room roster in the middle, full statblock editor on the right, with none of it in a modal.

- The statblock editor is driven by `systems[system].npcStatblock.fields`, the same definition `NpcModal` reads, and validates the same way on the server.
- **Copy to another room** — a dedicated config handler takes `{ roomId }`, resolves the source NPC by both `:id` and the source `room_id`, then validates `requireRoomConfig` and the shared system on **both** rooms before it inserts anything. A record from another room is a 404, never a copy source. This is the first cross-room write in the application; the double check is the whole of its safety.
- Bulk delete, and a filter over name, notes, and statblock text.
- `clone` and `from-catalog` are reused as they are.

### 3. Weapon and item lists

The hard one, because `systems/<id>/items.json` is inlined into the server bundle and is the declared authority for the system. It cannot be the thing a GM edits at runtime.

**A per-room overlay.** The effective catalogue for a room is:

```
system list  −  ids the room retired  +  items the room added
```

which is the same shape as `mergeCatalog`'s rule in `item-catalog.ts`, applied one layer further out. Nothing about the system catalogue changes; `npm run build:items` and `--merge` behave exactly as documented.

- **Ids.** A room item's id is `room:<roomId>:<slug>`, which the `itemId()` scheme can never produce, so a room item and a system item can never collide and a slot's `SlotWeaponDetail` pointing at one is never ambiguous.
- **The seam.** `characterItemsFor(system)` becomes `characterItemsFor(system, roomId?)` and applies the overlay when a room is given. There are exactly two call sites — `characters.ts:195` and `group.ts:201` — and both already have the room in hand. A character sitting in a pool with no room falls through to the system catalogue unchanged.
- **A retired item already on a sheet stays on the sheet.** Slots hold plain strings; retiring an id removes it from the picker and from nothing else. That is the same promise `retired` makes in `items.json`, and it is what keeps this safe.
- **Editing a system item** is retire-plus-add: the panel offers "customise", which validates the source item and the proposed room item first, then inserts the room item and retires the original in one database transaction. Either both writes commit or neither does, so the picker never loses the original without gaining its replacement.
- **Validation** runs the entry's name and parenthetical back through `shared/src/character-items.ts`, so a room item is read as a weapon on exactly the same terms as a rulebook one, and shows the GM what it parsed as before saving.
- **Copy to another room**, through the same source-room-qualified, double-gated handler shape as NPCs.
- **Export/import as JSON** in the `items.json` list shape, which is also the migration path if a room's additions later deserve to become part of the system.

_The alternative considered and rejected:_ letting an admin edit `systems/<id>/items.json` through the panel. It contradicts the compiled-in model, does not survive a container restart, and would put a shared file behind a per-room screen.

### 4. Calendar (when enabled) — setup, not the clock

**Reuses** `PUT /rooms/:id/calendar` unchanged, including its `revision` check.

The panel is the room-sized version of `CalendarModal`: month names, day names, segment names, and the events list edited as tables rather than as a stack of inputs, with add / remove / reorder, and the derived shape (days per week against day names, months against month names) checked as you type.

- **The 409 is a feature.** The panel holds the `revision` it loaded, and on 409 it refetches, shows what changed, and asks — the same contract the modal has, made visible rather than fatal.
- **`POST /rooms/:id/calendar/advance` is not called from here.** Advancing time writes a system message into the room's chat; it is a thing that happens at the table. The panel builds the calendar the clock then runs.
- Setting the _starting_ date is setup and is in scope — it goes through the same `PUT`, which is how the modal already sets it.
- The enable switch is here, going through `PATCH /rooms/:roomId` so the easter-egg-on-first-enable path is not bypassed.

### 5. Playlists (when enabled) — setup, not the transport

The only section with a genuinely new model. Today: one flat audio library, one playback state, no order.

```sql
CREATE TABLE IF NOT EXISTS room_playlists (
  id INTEGER PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  UNIQUE(id, room_id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS room_playlist_tracks (
  playlist_id INTEGER NOT NULL REFERENCES room_playlists(id) ON DELETE CASCADE,
  room_id INTEGER NOT NULL,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY(playlist_id, media_id),
  FOREIGN KEY(playlist_id, room_id) REFERENCES room_playlists(id, room_id) ON DELETE CASCADE,
  FOREIGN KEY(media_id, room_id) REFERENCES media(id, room_id) ON DELETE CASCADE
);
```

Both are new tables, so `CREATE TABLE IF NOT EXISTS` in `db.ts` is the whole table schema change; `media` also gains a supporting `UNIQUE (id, room_id)` index for the composite foreign key. A playlist track therefore cannot name media from another room. `ON DELETE CASCADE` on `media_id` means deleting a track removes it from every playlist for free.

- The panel manages playlists and their order; **`AudioPlayer` in the room gains a playlist selector** and plays through the chosen list. That is the one place the panel's new model reaches into the game UI, and it is what the roadmap's "add combat music" asks for.
- `room_state.audio_json` gains an optional `playlistId`. It is a JSON blob with a tolerant reader, so nothing needs migrating.
- **No transport controls.** `PATCH /rooms/:id/audio/playback` is not called from the panel; play, pause, seek, shuffle, and repeat are the room's. The panel decides what a playlist _is_.
- A track in no playlist is still in the library and still playable. Playlists are a view, not a gate.
- Metadata repair belongs here too: `mp3-metadata.ts` fills artist and title on upload, and the panel is the natural place to fix what it read wrongly and to re-run it over a batch.
- Every name, membership, or order mutation carries the playlist's current `revision`. The handler validates the entire replacement track set and its room before writing, then updates it and increments `revision` in the same transaction. A stale revision answers `409` rather than silently replacing a newer name or order.

---

## Sections 6 and 7 rest on a data-model change

Hirelings, ships, and obligations are the two remaining sections, and both are blocked on the same thing: **they are not records, they are array entries inside `room_state.group_json`.** Building a serious editor on top of that means building it on top of every consequence below, so the model changes first.

### What the blob costs today

- **A hireling has no identity the database knows about.** Its id is a client-minted string that falls back to `hireling-<n>` _by array position_, so reordering the array can silently rename one. `encounter_combatants.hireling_id` is a bare `TEXT` column pointing at that string with no foreign key, and resolving a combatant means scanning the blob (`encounters.ts:256`).
- **Referential integrity is hand-rolled.** Deleting a hireling explicitly deletes its `hireling_images` row and its `encounter_combatants` rows inside a transaction. Nothing enforces that a combatant's hireling exists; `visibleEncounter` drops combatants whose id no longer resolves and says nothing.
- **Concurrency is document-wide.** Two GMs editing two different hirelings collide, because the unit of contention is the whole group page. The PATCH route carries a guard that refuses any write which would drop a hireling, purely because a stale write otherwise deletes one by omission.
- **Nothing can be queried.** "Which rooms have a hireling named X", "how many ships does this room have", "hirelings in no encounter" are all blob scans in application code.
- **250 KB is a real ceiling** shared across hirelings, ships, obligations, and every group field, with the failure mode being a rejected save.

### The shape it becomes

**One row per thing, with its own `sheet_json` — exactly how `characters` already works.** This is not "no more JSON": a hireling's sheet is definition-driven by `groupPage.hirelings.sheet`, and a system that changes its sheet must not need a migration. The blob moves from _holding the roster_ to _holding one member's own fields_, which is the same job `characters.sheet_json` does and is the reason that table has never needed a schema change per system.

```sql
CREATE TABLE IF NOT EXISTS group_hirelings (
  id INTEGER PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  sheet_json TEXT NOT NULL DEFAULT '{}',
  portrait_filename TEXT,
  portrait_stored_name TEXT,
  portrait_mime_type TEXT,
  portrait_size INTEGER,
  -- The blob's client-minted string id, kept so the migration is re-runnable
  -- and so anything still holding one can be traced.
  legacy_id TEXT,
  UNIQUE(room_id, legacy_id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS group_assets (
  id INTEGER PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  -- 'starship' today; whatever kind the system's definition declares later.
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  sheet_json TEXT NOT NULL DEFAULT '{}',
  portrait_filename TEXT,
  portrait_stored_name TEXT,
  portrait_mime_type TEXT,
  portrait_size INTEGER,
  legacy_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS group_obligations (
  id INTEGER PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  owed_to TEXT NOT NULL DEFAULT '',
  amount TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  legacy_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Three consequences worth stating plainly:

- **Portraits become columns, not tables.** `characters` already carries `portrait_filename / stored_name / mime_type / size`; copying that retires `hireling_images` and `starship_images` entirely, along with the two-step lookup in `encounters.ts:267` and the four image routes' bespoke keying.
- **`sort_order` replaces array position**, so reordering is a write to one column and can never rename anything.
- **`room_state.group_json` keeps only the group's own fields** — the `GroupPageDefinition.sections` values. It stays a blob for the same reason a character sheet is one, and the 250 KB cap stops being a roster limit.

### The migration

Four steps in `db.ts` below the schema block, each idempotent and each detectable from `sqlite_master` rather than a counter, per `AGENTS.md`. They run in one `BEGIN IMMEDIATE` / `COMMIT` transaction: foreign keys are disabled before the transaction only where the rebuild requires it, and their prior setting is restored in a `finally` path if any step fails.

1. **Create the three tables** with `CREATE TABLE IF NOT EXISTS`. No migration needed for this part.
2. **Backfill from the blob, then strip the keys.** For each `room_state` row, parse `group_json`, insert one row per entry of `hirelings`, `starships` (falling back to legacy singular `starship`), and `obligations` (falling back to legacy `groupDebt`), preserving array order as `sort_order` and the string id as `legacy_id`; then rewrite `group_json` **without** those keys. Stripping is what makes the step idempotent by construction — a second run finds nothing to move — and it is the same legacy-fallback reading `parseGroupStarships` and `parseGroupObligations` already do, so those functions are the specification and should be lifted to `shared/` and reused rather than reimplemented.
   Before dependent data is copied, `group_hirelings` enforces `UNIQUE(room_id, legacy_id)`, and every legacy-ID lookup includes both columns. A legacy id is never allowed to resolve across rooms.
3. **Fold the image tables in**, copying `hireling_images` and `starship_images` onto the new rows by both `room_id` and `legacy_id`, then `DROP TABLE` both. The drop is the detectable signal: their absence from `sqlite_master` means the step has run.
4. **Rebuild `encounter_combatants`** so `hireling_id` becomes `INTEGER REFERENCES group_hirelings(id) ON DELETE CASCADE`. This changes a column type, a `CHECK`, and a foreign key, so it is the rooms-style rebuild: `PRAGMA foreign_keys = OFF` **outside** the transaction, create the replacement, copy rows mapping the old text id through `group_hirelings.room_id = encounters.room_id` and `group_hirelings.legacy_id`, drop combatants whose hireling no longer resolves (they are already invisible today), drop the original, rename, recreate both partial unique indexes, restore the pragma. Detect it from the stored `CHECK` text in `sqlite_master`, and derive the constraint from the shared source of truth so the _next_ change is recognised too.

Step 4 is the one to be careful with, and it is also the one that pays best: after it, deleting a hireling cascades, and the hand-rolled cleanup in `group.ts:295` and the silent drop in `visibleEncounter` both go away.

### What it simplifies on the way through

Not panel work — work the panel makes unnecessary:

- `updateHireling()` disappears. It exists only to merge one entry into a document.
- The "Remove hirelings through the dedicated delete route" 409 guard disappears. It exists only because a stale document write deletes by omission.
- The whole-document `updated_at` 409 becomes **per-row `updated_at`**, so two GMs editing two different hirelings no longer collide. This also replaces the `room_state.group_revision` column an earlier draft of this plan proposed — with rows, it is not needed.
- `hirelingFromState()` becomes a primary-key lookup.
- `client/src/group-hirelings.ts`, `group-starships.ts`, and `group-obligations.ts` shrink to types; their blob-parsing and legacy-fallback bodies move into the migration, which is the last thing that ever needs to read the old shape.

**Touch points, so the size is known up front:** `server/src/db.ts`, `group.ts`, `encounters.ts`, `characters.ts`, `media.ts`, `room-admin.ts`, `audio.ts`, `db-migrations.test.ts`, `group.test.ts`; `client/src/GroupPage.tsx`, `CombatantAvatar.tsx`, and the three `group-*.ts` helpers with their tests.

---

### 6. Hirelings / freelancers

On rows, the section is ordinary CRUD.

- Create, duplicate, delete, reorder, and rename, each a route against one row with its own `updated_at` check.
- **Portrait** upload and removal against the row's `portrait_*` columns, reusing `portrait-files.ts` exactly as `characters` does.
- The system's `creationRoll` via `POST /rooms/:id/group/hirelings/roll`, unchanged — it returns a hireling shape and now that shape is inserted rather than appended.
- The sheet is drawn from `groupPage.hirelings.sheet`, the same `CharacterSheetDefinition` the Group tab uses, so a system that changes its hireling sheet changes both surfaces at once.
- **Item slots follow the same rule as the character sheet**: the slot's text and its `SlotWeaponDetail` under `weaponOverrideKey(listKey)` are written together, and the record is cleared when the text changes. `setHirelingListItem` stays the single writer; the panel calls it rather than reimplementing the pairing.
- **Roster-scale operations the blob made awkward** are now cheap: bulk delete, "hirelings not in any encounter", and copy-to-another-room on the same double-gate as NPCs.

### 7. Group assets — ships, and strongholds when a system has one

No shipped system has a stronghold. Writing "stronghold" into the panel would mean writing it again for the next asset kind, so the section is **driven by the definition instead**, and `group_assets.kind` is what carries that at rest.

- Today `GroupPageDefinition` carries `starshipSheet?: StarshipSheetDefinition`. The panel reads whichever asset sheets the definition declares and renders each from its own definition — sizes, base values, holds, and installable parts read from the system's own tables by `starship-parts.ts`.
- The generalisation, when a second kind arrives, is a `groupAssets` record on `GroupPageDefinition` keyed by asset kind, with `starshipSheet` kept as an alias so no system package has to change on the day. **The panel and the `kind` column are written against that shape from the start**, so a stronghold is a system-package change and not a panel change, and not a migration either.
- Hold and part rules stay on the server: a bulky part occupies the hold after it, installing one is refused when that hold is taken or does not exist, capacity comes from the chosen size, and re-sizing rewrites what the size fixes while leaving raised scores alone. The panel is a wider editor for those rules, never a second implementation of them.
- Ship images move to the row's `portrait_*` columns with the rest.

---

## Schema summary

New tables — plain `CREATE TABLE IF NOT EXISTS` additions in `server/src/db.ts`:

- `group_hirelings`, `group_assets`, `group_obligations` — as above.
- `room_items` — `(id, room_id, item_id, list_key, item_json, created_by, created_at, updated_at)` with `UNIQUE(room_id, item_id)`.
- `room_retired_items` — `(room_id, item_id)` primary key.
- `room_playlists`, `room_playlist_tracks`.

Migrations against existing tables, each idempotent and detectable from `sqlite_master`:

- **Backfill** the three group tables from `room_state.group_json`, then strip the moved keys from the blob.
- **Fold in and drop** `hireling_images` and `starship_images`.
- **Rebuild `encounter_combatants`** for the integer `hireling_id` foreign key — the only rooms-style rebuild here, and the only place `PRAGMA foreign_keys = OFF` is needed.
- _(Phase 2, optional)_ `media.tags_json TEXT NOT NULL DEFAULT '[]'`, behind the `hasColumn` guard.

`room_state.group_revision` is **not** needed — per-row `updated_at` replaces it.

## API summary

Panel routes live under `server/src/room-config.ts` and `roomConfigRouter`, behind one `requireRoomConfig` gate. Existing game routes keep their current membership-only checks; where a panel action must also admit an admin who is not a room member, it uses a dedicated room-config handler that calls the shared resource operation after the gate rather than stacking a second role check on the game route.

| Route                                                                | Purpose                                                           |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `GET /api/room-config/rooms`                                         | The selector: rooms this account may configure                    |
| `GET /api/room-config/:roomId`                                       | One payload: room, flags, system definition, section availability |
| `PATCH /api/room-config/:roomId/media/bulk`                          | Bulk category / visibility                                        |
| `DELETE /api/room-config/:roomId/media/bulk`                         | Bulk delete                                                       |
| `POST /api/room-config/:roomId/npcs/:npcId/copy-to`                  | Copy an NPC to another configurable room                          |
| `GET/POST/PATCH/DELETE /api/room-config/:roomId/items`               | The room's item overlay                                           |
| `POST /api/room-config/:roomId/items/:itemId/retire`                 | Retire a system item for this room                                |
| `GET/POST/PATCH/DELETE /api/room-config/:roomId/playlists`           | Playlists and their tracks                                        |
| `GET/POST/PATCH/DELETE /api/room-config/:roomId/group/hirelings/:id` | One hireling row                                                  |
| `GET/POST/PATCH/DELETE /api/room-config/:roomId/group/assets/:id`    | One ship or other group asset                                     |
| `POST/DELETE /api/room-config/:roomId/group/hirelings/:id/portrait`  | Portrait, as `characters` does                                    |
| `PATCH /api/room-config/:roomId/group/order`                         | Reorder — writes `sort_order` only                                |

The room-config handlers reuse the existing validation and resource operations for calendar, media upload, NPC create/patch/clone/from-catalog, hireling creation roll, and starship parts, but do not call a membership-gated game route after `requireRoomConfig`. This keeps admin non-member access on one gate while preserving every resource ownership check.

The group routes are a **restructure of `groupRouter`, not an addition to it**: the Group tab moves onto the same row routes at the same time, so there is never one surface on rows and another on the blob. `PATCH /rooms/:id/group` survives, narrowed to the group's own fields.

**One rule for all of them:** `GET /api/room-config/rooms` always reads `configurableRooms`; every panel-qualified handler uses `requireRoomConfig`; existing game routes keep their existing `roomRole` checks. Admin non-member coverage is exercised for each reused media, NPC, item, playlist, and group handler, and no handler has both role checks.

## Live sync and conflicts

- The panel opens a WebSocket for the selected room and refetches the affected section on `media-updated`, `npcs-updated`, `group-updated`, `audio-updated`, `calendar-updated`, `room-updated`. Coarse events and a refetch, matching every other client.
- Every panel write broadcasts, so the GM's game tab updates without a reload. This is the main reason to reuse existing routes: they already do.
- **Conflicts are per-row.** Each group row carries its own `updated_at` and answers 409 on a stale write, so two people editing two different hirelings never collide — which is the practical difference between the blob and the rows. The calendar keeps its document-wide `revision`, correctly: it is one document.
- A 409 in the panel is never fatal: refetch, show the difference, offer to reapply.

## Testing

Matching how the repository already tests:

- **Unit, beside the source.** `room-config-permissions.test.ts` for the full matrix — player / GM-own / GM-other / admin-member / admin-non-member / archived room / missing room. `room-items.test.ts` for overlay resolution: retire hides, add appears, room id namespacing cannot collide with `itemId()`, a retired id still parses on a sheet, no room means the system catalogue exactly. `room-config.test.ts` for section availability against each system definition.
- **Room-config route coverage** includes an admin who is not a member for every reused media, NPC, item, playlist, and group handler; it also proves that NPC and item copy reject a source record from another room, playlist membership rejects media from another room, and stale playlist name or track-order revisions answer `409`.
- **The group migration is the part to test hardest**, in `db-migrations.test.ts`, each case written against a database built at the old schema with real blob contents, and **each confirmed to fail when its migration is removed**:
  - a blob with `hirelings`, `starships`, and `obligations` becomes rows in array order, with `legacy_id` preserved and the keys gone from the blob;
  - the legacy singular `starship` and the legacy `groupDebt` string migrate too — these are the shapes `parseGroupStarships` and `parseGroupObligations` still carry fallbacks for, so real databases have them;
  - an entry with no `id` gets one, and the `hireling-<n>` positional fallback resolves to the same row its image and combatants pointed at;
  - `hireling_images` and `starship_images` land on the right rows by matching both `room_id` and `legacy_id`, and the tables are gone;
  - an `encounter_combatants` row survives the rebuild with an integer `hireling_id`, one pointing at a vanished hireling does not, the two partial unique indexes come back, and deleting a hireling now cascades;
  - **running the whole migration twice changes nothing** — the property that makes it safe on a restart loop.
- **`scripts/room-config-smoke.mjs`**, added to the `smoke` script, driving a real server: a player is refused every route; a GM configures their own room and is refused another's; an admin configures a room they do not belong to and does not appear in its presence; an item added in the panel appears in that room's character payload and not in another room's; a playlist survives deleting one of its tracks; two hirelings edited concurrently both save, and the same hireling edited twice from a stale copy answers 409.
- **`scripts/encounter-smoke.mjs` and `group.test.ts` keep passing unchanged in behaviour.** They are the regression net for the migration: if a hireling can still be added to an encounter, drawn with its portrait, and deleted, the rewiring held.
- **Playwright**, beside `e2e/calendar.spec.ts`: open the panel from the rail in a new tab, edit in the panel, see the room tab update.

## Phasing

Each phase is releasable on its own.

1. **Shell and access** — `room-config-permissions.ts` with its tests, `GET /api/room-config/rooms` and `/:roomId`, the route and rail link, the room selector, the section list with everything empty. Nothing in the room changes; the permission model lands first because everything else sits on it.
2. **Library and NPCs** — the two sections that are almost entirely reuse, plus the bulk routes. This is the phase that proves the shell is worth opening.
3. **Calendar** — no schema at all, and the section that most obviously wants the room.
4. **The group data model** — the three tables, the four migrations, the `groupRouter` restructure, and the Group tab moved onto rows. **Ships with no new UI.** It is a refactor with a migration, and pairing it with a new screen would mean debugging both at once; `encounter-smoke.mjs` and `group.test.ts` passing unchanged is the release criterion.
5. **Hirelings and group assets** — both panel sections, now ordinary CRUD over rows, plus the `groupAssets` generalisation on `GroupPageDefinition`.
6. **Items** — `room_items`, `room_retired_items`, the `characterItemsFor(system, roomId)` seam, and the editor. Deliberately late, because it is the one section that changes what the game reads.
7. **Playlists** — the new tables, the panel section, and the `AudioPlayer` playlist selector in the room.

Phases 6 and 7 are independent of everything after phase 2 and can move earlier if the group migration needs more room. Phase 4 is the only one that is worth doing whether or not this panel is ever built.

## Open questions

1. **Does the whole group model move at once, or hirelings first?** Planned as one phase, because `encounter_combatants` has to be rebuilt either way and doing that rebuild once is much safer than twice. Splitting it is possible if phase 4 looks too large in practice.
2. **Do `legacy_id` columns stay forever?** Planned as yes — nullable, documented, and cheap. Dropping them later is another table rebuild, which is a worse trade than three unused columns.
3. **Cross-room copy.** Planned for NPCs and items only. Should hirelings and library assets copy too? Hirelings are now rows and would be easy; assets mean duplicating an upload, which is a storage question rather than a permissions one.
4. **Admin observability.** Should a room see any trace of an admin having configured it — a system message, or nothing at all? Nothing is planned.
