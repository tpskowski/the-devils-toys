# The wiki

A plan for a per-room wiki: files and folders written by the people in the room. Every player has a private workspace they can use without permission; the GM decides which files are shared with the whole table.

It is the one thing this application has never had a home for. Rules live in the system, tables live in the table sets, and the Library holds handouts as files; none of them is a place to write down who the Duchess is, what the party owes the guild, or what is actually behind the third door. That gets kept in someone else's notes application, where it cannot be shown to a player, cannot mention an NPC the room already has, and cannot travel with a campaign export.

[Milkdown](https://github.com/Milkdown/milkdown) is what an author types into. It is MIT, pinned with all of its packages to the current published 7.21.3 release, built on ProseMirror and remark, and it is a **plugin framework rather than an editor** — which matters here more than the WYSIWYG does, because mentions are custom nodes.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Markdown in `wiki_pages.markdown` is the source of truth. Milkdown is a view onto it**, exactly as the Devil's Tables grid is a view onto `table_sets.markdown`. Nothing stores a ProseMirror document, a JSON tree, or a second copy. `AGENTS.md` already forbids a second store for table contents; this is the same rule for the same reason. |
| 2   | Take **`@milkdown/kit` + `@milkdown/react`**, not `@milkdown/crepe`. Crepe is a finished editor with its own theme and fonts (3.4 MB unpacked against kit's 121 KB) and it would fight the nine room themes it knows nothing about.                                                                                                                |
| 3   | **Reading is `react-markdown`** — the renderer this client already ships and already uses for rules, references, and NPC notes. A reader never downloads an editor; the editor chunk is `lazy()`d behind Edit and is fetched only by someone editing a file they own or administer.                                                                |
| 4   | Which means **two renderers**, so the syntax they share lives in one place: a remark plugin in `shared/`, used as a `remarkPlugins` entry by react-markdown and as a `$remark` by Milkdown. Both are remark; that is the whole reason this is affordable.                                                                                          |
| 5   | A mention is a **text directive** — `:npc[Grushak]{id=12}` — parsed by the same plugin. There is no syntax for GM-only text. A file is either private to its owner and the GM, or shared whole.                                                                                                                                                    |
| 6   | **Sharing is per file, `wiki_pages.visible`**, in the exact shape `media.visible` already has. Only the GM changes it. A private file is available to its owner and the GM, and is not listed, linkable, searchable, or fetchable by other players.                                                                                                |
| 7   | **Players can always create files and folders while the wiki is enabled.** They may edit, move, and delete what they own. The GM administers everything in the room and is the only person who can share or unshare a file.                                                                                                                        |
| 8   | **Folders organise files but grant no access of their own.** A player sees their own folders plus the ancestor folders needed to locate files they may read. Sharing a file therefore shares its displayed path, not the other files beside it.                                                                                                    |
| 9   | **`wiki_enabled` defaults to on.** It is the only room feature that does; the calendar, music, and map notation all default off. A GM asked for a notebook, and a notebook nobody switched on is a notebook nobody has.                                                                                                                            |
| 10  | **A map legend is not a new kind of thing.** It is an ordinary wiki file with `map_media_id` set, which gets sharing, mentions, ownership, import, and export for free.                                                                                                                                                                            |
| 11  | **`wiki/` becomes a campaign bundle folder** beside `maps/` and `npcs/`. Mentions travel as _bundle paths_, never as row ids, and are resolved on import through the id maps the importer already builds for encounters.                                                                                                                           |
| 12  | Concurrency is the calendar's **`revision` and a 409**, the one optimistic-concurrency story in the codebase. No `@milkdown/plugin-collab`, no Yjs, no second transport.                                                                                                                                                                           |
| 13  | **NPCs gain a `revealed` flag**, because they have none. This is the one part of the plan that reaches outside the wiki, and it is unavoidable: `server/src/npcs.ts:68` gates the entire NPC router to the GM, and `readRoomTags` refuses a player every NPC tag outright.                                                                         |

### Assumptions, flagged so you can overrule them

- **"Resources" is read as Library assets, this room's items, and other wiki pages.** Those are the three things in a room that a page would want to point at and that are not cast. Roll tables are the obvious fourth and are left for later, because a table link already has a syntax (`devils-table:`) and it would want to keep it.
- **A mention a player may not resolve renders as its own label, in plain text.** The GM wrote "Grushak" in prose they revealed; withholding the word they chose to show is not what "unrevealed" should mean. What is withheld is the link, the hover, and the fact that this room has a record by that name.
- **A player's new file starts private.** The GM can share it when it is ready. Once shared, its owner may keep editing it and the GM may unshare it at any time; sharing is access control, not an approval workflow.
- **Folders may nest.** A player creates at the root or inside a folder they own, cannot add material to somebody else's folder, and cannot delete a non-empty folder. The GM can create, move, rename, or remove anything.
- **Desktop-first for the editor, phone-ready for the reader and basic authoring**, per `AGENTS.md`. A player must at least be able to create a file, write Markdown, and save it on a phone even if the richer toolbar is arranged for a wider screen.

---

## What exists today

The plan has to work with these, not around them.

- **Markdown already renders, twice.** `client/src/RulesMarkdown.tsx:26` is the block renderer — react-markdown with `remark-gfm`, heading anchors, `devils-table:` links turned into roller buttons, external links opened safely, and tables wrapped in a scroll region. `client/src/InlineMarkdown.tsx` is the compact one. Neither takes a plugin from outside its own file yet.
- **Markdown is already a Library asset.** `media` rows may carry `text/markdown` (`server/src/media.ts`, `client/src/MediaContent.tsx:6`), uploaded as a reference, stored as a file under `uploads/`, and rendered through `RulesMarkdown`. That is the closest thing to a wiki the application has, and its limits are the case for this plan: a file, no editing, no linking, no structure, one visibility bit.
- **Reveal is `media.visible`,** a single room-wide flag, set by `POST /rooms/:id/references/:mediaId/reveal` (`server/src/media.ts:452`) and enforced by the list route and by `/media/:id/file` alike. There is also `revealed_references`, a per-account reveal table that nothing reads any more. Wiki ownership is not another reveal table: ownership answers who may edit a private file; `visible` still answers whether the room may read it.
- **Room features are a column on `rooms` and a section in Room Config.** `calendar_enabled`, `map_notation_enabled`, `music_enabled` (`server/src/db.ts:55-58`), each added by a `hasColumn` migration, each surfaced by `sectionsFor` (`server/src/room-config.ts:29`) as a section carrying `enabledBy`, each settable through `PATCH /rooms/:id` and carried by a campaign's `room.json`.
- **A subject-per-column table with a CHECK is the house shape** for "points at exactly one of several kinds": `room_tags` (`server/src/db.ts:410`) and `encounter_combatants`. It is the only way the pointer can be a real foreign key, so a deleted NPC takes its rows with it instead of leaving rows a later NPC with the same id would inherit.
- **Per-role reads are decided on the server, by kind.** `readRoomTags` (`server/src/room-tags.ts:82`) is the model: a GM sees the room; a player sees their own characters, the party's hirelings, the Library entries revealed to them, and **no NPCs at all**.
- **The NPC router is GM-only, all of it.** `server/src/npcs.ts:68` answers 403 to a player for the list, the catalogue, and every write. The only NPC a player ever sees is a combatant standing in an encounter.
- **Optimistic concurrency exists once**: `PUT /rooms/:id/calendar` compares `revision` and answers 409 (`server/src/index.ts:532`).
- **Campaign bundles are folders that declare their own contents** (`server/src/campaign-bundles.ts:43`), with an optional `index.json` per folder for display names and ordering. `references/` already accepts `.md`. The importer resolves cross-references through maps from bundle path to row id (`npcIds`, `hirelingIds` in `server/src/campaign-apply.ts`), and the ledger (`server/src/campaign-ledger.ts`) records a **source** digest and a **state** digest per path so a re-import can tell "the bundle changed" from "the room changed it".
- **Standalone pages are code-split already.** `client/src/main.tsx:35` lazy-loads Room Config and the guides, and the server serves `index.html` for any unmatched path, so a new surface needs no server route.
- **Map notation is a per-map overlay** (`map_notations`, `client/src/MapNotationLayer.tsx`) gated on `rooms.map_notation_enabled` and on the map being visible. A legend icon lands on the same map, under the same visibility question.
- **New tables need no migration**; `db.ts` runs `CREATE TABLE IF NOT EXISTS` on every start. Only a **column on an existing table** needs the `hasColumn` guard.

---

## The store

```sql
CREATE TABLE IF NOT EXISTS wiki_pages (
  id INTEGER PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  folder_id INTEGER REFERENCES wiki_folders(id) ON DELETE SET NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  markdown TEXT NOT NULL DEFAULT '',
  visible INTEGER NOT NULL DEFAULT 0,
  -- A legend is a page pointed at a map. At most one per map.
  map_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  owner_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS wiki_pages_slug ON wiki_pages (room_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS wiki_pages_legend
  ON wiki_pages (map_media_id) WHERE map_media_id IS NOT NULL;
```

Folders are rows too, because they have ownership, ordering, and stable identity:

```sql
CREATE TABLE IF NOT EXISTS wiki_folders (
  id INTEGER PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES wiki_folders(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  owner_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS wiki_folders_name
  ON wiki_folders (room_id, COALESCE(parent_id, 0), name COLLATE NOCASE);
```

The routes validate that a folder and its parent belong to the same room and reject cycles. A player may create at the root or below a folder they own. A folder is visible to a player when they own it or it is an ancestor of a file they may read; it has no independent sharing flag. Deleting a non-empty folder is refused rather than silently moving its contents.

`slug` is minted from the title and is what a link points at, so renaming a page does not break every page that mentions it — the slug is stable and the title is free. It is unique per room, in the shape `room_items` already keys itself.

The markdown is capped at 256 KB by the request schema, in the spirit of the 250 KB cap `groupStateSchema` already puts on the group blob. A page that wants to be bigger than a novella chapter wants to be two pages.

**Not** files under `uploads/`. A wiki page is edited on every session, carries a revision, and is pointed at by other rows; that is a row. Library markdown references stay files and stay where they are — the wiki does not swallow them, and `POST /rooms/:id/wiki/pages/from-reference/:mediaId` copies one in for a GM who wants it to become a page.

---

## Milkdown, and what is taken from it

```
@milkdown/kit      7.21.3   core, transformer, commonmark + gfm presets, and the
                            history / listener / clipboard / slash / tooltip /
                            block plugins, all at one version
@milkdown/react    7.21.3   <Milkdown /> and useEditor, peer-compatible with React 19
remark-directive   4.0.0    the mention grammar
```

Three dependencies, one of them not Milkdown's. What is used:

- `@milkdown/preset-commonmark` and `-gfm` for the ordinary editing — headings, lists, tables, code, links.
- `@milkdown/plugin-listener` for `markdownUpdated`, which is how the markdown gets back out. Debounced, then `PUT`.
- `@milkdown/plugin-slash` twice: once on `/` for a block menu, once configured to `@` for the mention picker.
- `@milkdown/utils`' `$remark`, `$nodeSchema`, `$inputRule`, `$view` to bind the shared remark plugin to editor nodes and to draw them.
- `@milkdown/plugin-history`, `-clipboard`, `-cursor`, `-trailing` because they are free and their absence is noticed immediately.

What is deliberately not used: **Crepe** (decision 2), **`@milkdown/plugin-collab`** (decision 12), and **`@milkdown/plugin-upload`** in v1 — an image in a page is a Library asset chosen from the Library, not a second upload path with a second storage rule.

Styling is ours. Milkdown ships no opinion beyond structure at the kit level, so the editor is styled from the same nine theme custom properties every room theme defines, and any `select` in its toolbar follows the drop-down rule in `AGENTS.md` — solid `var(--surface)`, `var(--text)`, `var(--line)`, square corners, explicit height, and the same on its `option` elements.

**Measure the chunk in phase 2.** The budget is not a number, it is a shape: the editor is fetched when an author presses Edit and at no other time, and `npm run build` must show it as its own chunk rather than as growth in the main one.

---

## One plugin, two renderers

`shared/src/wiki-markdown.ts` holds the mention grammar and everything that reads it. It is the file both worlds import, and the only file that knows the syntax.

```ts
/** The kinds of thing a page may point at. A kind this build has not got is not a mention. */
export const WIKI_MENTION_KINDS = ["pc", "npc", "follower", "asset", "item", "page"] as const;

/** remark-directive plus our own node types, for react-markdown and for Milkdown alike. */
export function remarkWiki(): Plugin;

/** Every mention a document holds, in order, with its kind and target. */
export function wikiMentions(markdown: string): WikiMention[];

/** The document with the mentions this reader may not resolve reduced to their labels. */
export function plainMentions(markdown: string, keep: (mention: WikiMention) => boolean): string;
```

`WIKI_MENTION_KINDS` is a fixed list in the shape `SYSTEM_RULE_FEATURES` and `THEME_IDS` already have: nothing reads a mention's kind to work out what it means beyond looking it up in that list, and a directive naming a kind this build does not have is not a mention — it is the text someone typed.

`unified`, `remark-parse`, `remark-stringify`, and `remark-directive` are direct dependencies of the **shared workspace**, because that workspace imports them. esbuild inlines them into the server bundle; none is added to the `--external` list. The client declares its Milkdown packages directly. This avoids relying on npm workspace hoisting for an undeclared dependency.

There is deliberately no GM-only inline or block syntax. Access is decided before Markdown is read:

```
GET /api/rooms/:roomId/wiki/pages/:slug
  → GM                                      → page
  → owner                                   → page
  → another player and visible = 1          → page
  → another player and visible = 0          → 404, not 403
  → resolve mentions against that reader    → labels for what they cannot see
  → send
```

Search follows the same candidate rule in SQL: a GM searches the room, while a player searches `owner_account_id = accountId OR visible = 1`. Because an accessible file contains no server-redacted regions, `LIKE` over those candidate rows cannot match text the reader was denied.

---

## Mentions

```markdown
:pc[Vess]{id=41} owes :npc[Grushak]{id=12} a favour, and the debt is written
in :page[the ledger]{slug=guild-ledger}.
```

The label is the author's words; the attribute is the target. Both renderers draw a resolvable mention as a chip carrying the subject's own colour and a click that opens it — a character sheet, an NPC, a Library asset, another page.

### What a reader may resolve

| Kind       | Points at         | GM  | Player                                                     |
| ---------- | ----------------- | --- | ---------------------------------------------------------- |
| `pc`       | `characters`      | all | the characters that room already lets them see             |
| `follower` | `group_hirelings` | all | the party's, as the group page already shows them          |
| `npc`      | `custom_npcs`     | all | **only where `custom_npcs.revealed = 1`** — see below      |
| `asset`    | `media`           | all | `visible = 1`, the Library rule unchanged                  |
| `item`     | `room_items`      | all | all — a room's catalogue is already offered to its players |
| `page`     | `wiki_pages`      | all | owned by that player, or `visible = 1`                     |

A mention a player may not resolve becomes its label, in plain text, on the server. Nothing about the target reaches the browser: no id, no kind, no chip.

### The index

```sql
CREATE TABLE IF NOT EXISTS wiki_mentions (
  page_id INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('pc','npc','follower','asset','item','page')),
  character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
  npc_id INTEGER REFERENCES custom_npcs(id) ON DELETE CASCADE,
  hireling_id INTEGER REFERENCES group_hirelings(id) ON DELETE CASCADE,
  media_id INTEGER REFERENCES media(id) ON DELETE CASCADE,
  target_page_id INTEGER REFERENCES wiki_pages(id) ON DELETE CASCADE,
  item_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  CHECK (/* exactly one of the pointers, per kind */)
);
```

The column-per-kind CHECK, because that is the only shape in which the pointer is a real foreign key — and here that buys the specific thing `AGENTS.md` says it buys on `room_tags`: **a deleted NPC takes its mention rows with it**, so a later NPC that happens to land on id 12 does not inherit a sentence about someone else.

The index is derived, rewritten **whole** on every save from `wikiMentions()`, exactly as a subject's tags are written whole. The markdown stays the truth; this is what makes "what links here" a query instead of a scan, and what makes a player's permission filter one join instead of one query per mention.

### The picker

`@milkdown/plugin-slash` configured to `@`, offering **what this author may already see** — which is the whole of requirement 6, and it falls out of asking the server rather than of a rule written into the editor:

```
GET /api/rooms/:roomId/wiki/mentionables?q=gru
```

is answered by role. A GM gets the room. A player gets their characters, the party's followers, the revealed NPCs, the revealed assets, the room's items, their own files, and files shared with the room. A player cannot mention what they cannot read because the list they pick from does not contain it — and the `PUT` re-checks it anyway, because a picker is a convenience and a route is a rule.

---

## Ownership, sharing, and the NPC gap

Two switches, and they are not the same switch:

1. **`rooms.wiki_enabled`** — does this room have a wiki at all. Default 1.
2. **`wiki_pages.visible`** — may every room member read this file. Only the GM changes it.

`owner_account_id` is explicit ownership. A player can always create a file or folder while the wiki is enabled. They can read, edit, move, rename, and delete their own files; read shared files; and cannot mutate somebody else's file. The GM and an administrator acting through `roomAccessRole` may read and administer everything. If an owner account is deleted, `owner_account_id` becomes null and the file or folder becomes GM-managed rather than orphaned.

A file is shared with a button on the file and from the list, both in the room and in Room Config, in the shape the Library's reference reveal already has. A player may not set `visible` during create or update. A file that stops being visible stops being fetchable by other players in the same instant; its owner keeps it. `broadcastRoom(roomId, { type: "wiki-updated" })` makes every open reader refetch, and a reader who just lost access returns to the list with a note rather than keeping a stale document on screen.

Folders are filtered after accessible files are selected. A player receives folders they own plus the ancestor chain of every file they may read. An empty folder belonging to another player is therefore invisible; sharing a file reveals only the names of the folders on its path. Moving a shared file changes that visible path and requires either its owner or the GM.

**The NPC gap is real and has to be closed for requirement 6 to mean anything.** `custom_npcs` has no visibility of any kind: the router is GM-only and `readRoomTags` returns no NPC to a player, ever. So:

```sql
ALTER TABLE custom_npcs ADD COLUMN revealed INTEGER NOT NULL DEFAULT 0;
```

with a toggle in the NPC panel and in Room Config → NPCs, and a `GET /rooms/:id/npcs/revealed` that answers a player with **id and name only**. Existing `notes` are unrestricted GM notes and must not be exposed, and `custom_npcs` has no portrait storage to promise. "The party has met Grushak" and "the party may read Grushak's notes or hit protection" are different sentences, and only the first one is what a mention needs. Default 0, so no existing room reveals anybody by being upgraded.

This is a small feature in its own right and it should probably be its own commit before the wiki's, since the NPC panel is where it belongs and the wiki is only its first customer.

---

## The map legend

A legend is a wiki file with `map_media_id` set. That is the whole design, and everything else follows from it: a legend is shared like a file, owned like a file, mentions like a file, and imports and exports like a file.

- **Binding** — Room Config → Library, on a map: **Legend: none / choose a page / write one**. The unique partial index keeps it to one per map.
- **The icon** — `SceneViewer` draws a legend button over the active map when the map has a legend the reader may see, beside the notation controls. Pressing it opens the page in a panel over the map rather than navigating away; the map stays where it was.
- **Visibility is two questions, both asked** — the map must be visible to the reader (it already must be, for them to be looking at it) _and_ the page must be visible. A revealed map with an unrevealed legend draws no icon at all, because an icon that does nothing is a GM telling the table there is something to find.
- **What a player gets** is the whole file when it is shared. Secret map notes belong in a separate private file; there is no partial-document access mode.

Pins — a coordinate on the map linked to a heading in the legend — are the obvious next thing and are **not** in this plan. `map_notations` already stores labels at normalised coordinates and is the place they would go.

---

## Campaign import and export

`wiki/` joins `FOLDERS` in `server/src/campaign-bundles.ts`, taking `.md` and preserving the folder tree:

```
wiki/
  the-duchess.md
  guild-ledger.md
  maps/the-undercroft.md      ← a legend, bound by index.json
  index.json
```

The current bundle validator rejects every nested campaign path. Adding wiki folders therefore includes one explicit topology change: paths below `wiki/` may nest to a bounded depth, while every other campaign folder keeps the existing "files directly" rule. Archive traversal checks, entry and byte caps, and extension checks still run on every nested wiki file.

`wiki/index.json` has a strict schema with `files` and `folders`. A file entry names its relative path, display title, order, `visible`, and optional `map` path. A folder entry names its relative path and order, which is also how an empty folder survives a zip round trip. Everything is optional; a zip holding only Markdown below `wiki/` imports, derives folders from paths, and titles each file from its first Markdown heading, falling back to its filename.

**Mentions travel as bundle identities, never destination row ids.** A bundle's file says `:npc[Grushak]{path=npcs/grushak.json}` and `:page[the ledger]{path=wiki/guild-ledger.md}`; the importer rewrites them to `id=` / `slug=` through `npcIds`, `hirelingIds`, `mediaIds`, and the new `wikiIds` map.

Two kinds need explicit rules because the current campaign format cannot map them:

- A character is a person and does not travel in campaign exports. A `pc` mention is exported as its plain label and a warning names the wiki file that lost the link.
- A system-catalogue item keeps its stable catalogue id. A room-created item gains a bundle `key` in `items/index.json`; an exported mention uses `path=items/index.json#<key>`, and `applyItems` fills a new `itemIds` map as it mints destination ids. The key, not array position or item name, is the identity.

A path that resolves to nothing is left as its label and **reported as a warning naming the file**, since the failure this format must never have is the silent one.

The ledger takes a `wiki` kind: **source** is the file's bytes plus its index metadata; **state** is title + markdown + folder + visible + the bound map, as the importer left them. Imported files and folders are owned by the importing account; ownership never travels as an account id. That gets the three cases the ledger exists for — unchanged, updatable, edited — without throwing away a session's writing.

`room.json` gains `wikiEnabled` beside `musicEnabled`.

---

## Schema summary

| Table                  | Change                                    |
| ---------------------- | ----------------------------------------- |
| `wiki_folders`         | new, nested ownership and ordering        |
| `wiki_pages`           | new, owned files; optional folder and map |
| `wiki_mentions`        | new, derived, rewritten whole per save    |
| `rooms.wiki_enabled`   | added, `hasColumn` guard, **DEFAULT 1**   |
| `custom_npcs.revealed` | added, `hasColumn` guard, default 0       |

No constraint on an existing table changes, so this feature does not itself trigger a rooms-style rebuild. `wiki_enabled` must nevertheless be added to both the canonical `roomsColumns` definition and its `preservedColumns` list so a later theme/system rebuild cannot discard it. `db-migrations.test.ts` gains a case for each added column plus a rebuild case proving the wiki setting survives, and each must be shown to fail with its migration removed.

## API summary

```
GET    /api/rooms/:roomId/wiki                       list, filtered by role
GET    /api/rooms/:roomId/wiki/pages/:slug           owner, GM, or room-shared; mentions resolved by role
POST   /api/rooms/:roomId/wiki/pages                 any room member; owner is the authenticated account
PUT    /api/rooms/:roomId/wiki/pages/:slug           owner or GM; body carries `revision`; 409 when stale
POST   /api/rooms/:roomId/wiki/pages/:slug/reveal    GM only  { visible }
DELETE /api/rooms/:roomId/wiki/pages/:slug           owner or GM
POST   /api/rooms/:roomId/wiki/folders                any room member; root or an owned parent
PATCH  /api/rooms/:roomId/wiki/folders/:folderId      owner or GM; rename, move, order
DELETE /api/rooms/:roomId/wiki/folders/:folderId      owner or GM; empty folders only
GET    /api/rooms/:roomId/wiki/mentionables?q=       answered by role
GET    /api/rooms/:roomId/wiki/search?q=             searches only rows this reader may fetch
POST   /api/rooms/:roomId/wiki/pages/from-reference/:mediaId  GM only
POST   /api/rooms/:roomId/maps/:mediaId/legend       GM only  { slug | null }
GET    /api/rooms/:roomId/npcs/revealed              players; id and name only
```

One gate module, `server/src/wiki-permissions.ts`, in the shape of `table-permissions.ts` and `room-config-permissions.ts`: `mayReadWikiFile`, `mayEditWikiFile`, `mayManageWikiFolder`, `requireWikiGm`. Every helper takes the resolved row where ownership matters, and every create/move validates room ownership at the write boundary. Put a new route behind one; do not write another role check.

Room Config gains a `wiki` section — `ROOM_CONFIG_SECTIONS` in `shared/src/index.ts:87` grows an entry, `RoomConfigToggle` at line 108 grows `wikiEnabled`, `sectionsFor` grows a row, and `RoomConfigWiki.tsx` joins its siblings.

## Live sync and conflicts

`wiki-updated` on the existing `broadcastRoom`, coarse like every other event — clients refetch. Two writers on one page is the calendar's story: `revision` in, `revision + 1` out, 409 with the current document when they disagree, and the loser is offered their own text beside the one that landed. Real-time co-authoring is `@milkdown/plugin-collab` plus a Yjs transport plus a second persistence story, and it is not worth a second transport for a document two people edit in the same hour perhaps twice a year.

## Testing

- `shared/src/wiki-markdown.test.ts` — the load-bearing grammar file. Mentions round-trip with labels holding brackets, braces, and newlines; an unknown kind stays text; attributes never become arbitrary HTML properties.
- `server/src/wiki.test.ts` — file and folder CRUD, stable slugs, folder cycles and non-empty deletion refused, the 409, the mention index rewritten whole, and an NPC deletion taking its mention rows.
- `server/src/wiki-permissions.test.ts` — **the security file**. A player creates and edits their own private file and folders without a setting; another player gets 404; the GM may read it and share it; sharing exposes it to the room but not for editing; unsharing removes everyone except its owner and GM; folder lists expose only owned folders and ancestor paths; `mentionables` must not name an unrevealed NPC or another player's private file; a `PUT` carrying either mention is refused; search does not match inaccessible rows. Assert against the HTTP payload, never the DOM.
- `server/src/campaign-roundtrip.test.ts` — nested folders, an empty folder, a wiki file with a portable mention and legend binding, exported and re-imported, come back the same; PC mentions degrade with a warning; room-item mention keys resolve to newly minted ids; an unresolvable target is reported.
- `scripts/wiki-smoke.mjs`, added to `npm run smoke` beside the other twenty.
- `e2e/wiki.spec.ts` — one player creates a folder and private file in Milkdown, another cannot see it, the GM shares it, and the second player can read but not edit it. A read-only session does not request the editor chunk.

## Phasing

1. **The store, routes, ownership gate, reader, and folders.** `wiki_folders`, `wiki_pages`, the room panel, the Room Config section, and the one room switch. Editing is a textarea. At the end, every player can keep private files and the GM can share them.
2. **Milkdown.** The lazy chunk, presets, listener, mobile-safe fallback controls, and bundle measurement. The textarea goes.
3. **`custom_npcs.revealed`,** its toggle, id-and-name-only route, and player tag filtering. Its own commit; the NPC panel is where it belongs.
4. **Mentions.** `shared/src/wiki-markdown.ts`, remark-directive, the index, `mentionables`, the `@` picker, per-role resolution, and chips.
5. **The legend.** The binding, the icon on the map, and the panel.
6. **Campaign import and export**, nested wiki paths, portable item keys, the ledger kind, and the round trip.
7. **The guide and changelog** — `docs/guide/gm/` documents sharing and administration; the player's guide covers private files, folders, sharing, and chips; `AGENTS.md` gains a `## The wiki` section stating the invariants: Markdown is the source of truth, file access is enforced on the server, only the GM changes room-wide sharing, and one remark plugin serves both renderers.

## What this does not do

- No real-time co-authoring, no presence cursors, no comments.
- No page history or diffs. `revision` is a conflict counter, not a version store. Worth doing later, and cheap to add — a `wiki_page_revisions` table written on save — but it is a second store for the same text and deserves its own decision.
- No cross-room wiki, no shared world bible. A page belongs to a room, and the way it reaches another room is a campaign export.
- No uploads from inside the editor in v1. An image is a Library asset picked from the Library.
- No inline or block-level secret text. Private notes are private files; shared files are shared whole.
- No legend pins.
- No FTS5. Search is `LIKE` over titles and bodies after the query has been restricted to files the reader may fetch, which is right for a room holding tens of files. Whether `node:sqlite` ships FTS5 needs checking before anyone promises otherwise.

## Open questions

1. **Are shared player-owned files live or moderated?** This plan makes them live: after the GM shares one, its owner may continue editing it. A review-before-publish workflow would need a draft or approval revision and is intentionally not implied by the visibility bit.
2. **Are roll tables a mention kind?** They have their own link syntax already, and two ways to point at a table is one too many.
3. **Where does the wiki sit in the room's rail** — its own entry, or a tab inside the Library beside maps, scenes, and references? The Library is where a player already looks for something to read.
4. **Does a legend want to be one file per map, or one file with a heading per map?** The index says one per map; a GM running a dungeon of twelve rooms may disagree.
