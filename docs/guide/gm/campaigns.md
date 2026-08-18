# Campaigns

A **campaign** is a room's worth of prepared material in one zip: maps, scenes,
handouts, music, NPCs, encounters, the shop's stock, the party's hirelings, the
calendar the world runs on. You import one into a room and it all lands at once,
instead of uploading forty maps one at a time.

It is not a game system. A system says what a game _is_ — sheets, statblocks,
rulebooks — and an admin installs it for the whole server. A campaign says what
your table is _playing_, it belongs to one room, and you import it yourself from
**Room Config → Campaign**.

## Making one

Make a folder, put things in folders inside it, and zip it. That is the whole
format:

```text
tomb-of-the-serpent-kings/
├── maps/            the-keep.png, under-halls.png …
├── scenes/          somewhere the party is rather than somewhere they fight
├── references/      handouts: images, or Markdown you have written
├── audio/           .mp3 only
├── playlists/       combat.json — a name and the tracks it plays
├── npcs/            lady-vane.json — one file per NPC
├── encounters/      the-gate.json — a prepared fight
├── items/           index.json — gear this room adds to the system's lists
├── hirelings/       brann.json, and brann.png if they have a face
├── assets/          the ship, the stronghold — whatever your system has
├── obligations/     what the party owes, and to whom
├── tables/          random tables, in the shape The Devil's Tables exports
├── manifest.json    what this campaign is called, and which system it is for
├── room.json        a name, a theme, and which room features to switch on
├── calendar.json    months, days, and the year it starts in
└── campaign.md      a paragraph about it, shown when you import
```

**A folder's name is what makes its contents what they are.** A zip holding
nothing but a `maps/` folder is a complete, valid campaign — no manifest, no
JSON, nothing else to write. That is the shortest way in: drop a dozen images
into a `maps` folder, zip it, import it.

Everything else only ever adds detail. A folder can carry an `index.json` giving
display names and the order things appear in:

```json
{
  "files": [
    { "file": "the-keep.png", "name": "The Keep" },
    { "file": "under-halls.png", "name": "The Under Halls" }
  ]
}
```

Without it, a file is named after itself — `the-keep.png` becomes "the keep".

### The one rule to remember

**Nothing inside a campaign refers to anything by number.** An encounter names
the map it happens on and the NPCs in it by their paths in the zip:

```json
{
  "name": "The Gate",
  "map": "maps/the-keep.png",
  "zones": ["Gatehouse", "Courtyard"],
  "combatants": [{ "npc": "npcs/lady-vane.json", "side": "enemies", "zone": "Gatehouse" }]
}
```

If a path does not point at something the zip contains, the import is refused and
tells you which file and which name. That is deliberate: a fight quietly missing
its third goblin is something you find out mid-session.

### The fastest way to learn the format

Set a room up by hand and press **Export this room**. What comes out is a
campaign in the layout above, made from your own material. Open it, change it,
import it somewhere else.

## Importing one

Room Config → **Campaign** → **Import a campaign**. Nothing is written yet. You
get a summary of what it would do:

- how many of each thing are new, and how many are already here;
- how much it will store, against how much room the server has left;
- anything the campaign assumed rather than said — a bundle with no manifest is
  named after its file;
- anything that will not survive the trip, said plainly.

Read it, then press **Import into this room**. If you do not like it, press
Cancel and nothing has happened.

**A campaign written for another system is refused**, naming both. Its item
lists and statblocks are shaped by the system it was made for. A campaign that
carries only maps, scenes, handouts, music, and tables says it needs no system at
all, and imports into any room — that is what a map pack is.

### When something is already there

If the campaign brings something the room already has, you choose once for the
whole import:

- **Leave what is here alone** — the safe one, and the default.
- **Let the campaign overwrite it** — you want the campaign's version.
- **Add the campaign's beside it** — you want both.

### Importing the same campaign again

This is the part worth knowing about. The room remembers what an import left, so
importing a corrected or extended version of the same campaign does the sensible
thing without being told:

- anything the campaign has not changed is left alone entirely — nothing is
  rewritten and nothing is re-uploaded;
- anything the campaign _has_ changed, and you have not touched, is brought up to
  date;
- anything **you** have changed since it arrived stays exactly as you left it.

So an NPC whose notes now read "died in session four" survives a re-import of the
campaign that first brought her. If you want the campaign's version back, choose
_Let the campaign overwrite it_.

Encounters are the exception: one you already have is never replaced, whatever
you choose. A fight in progress carries hit points, initiative, and positions
that a re-import cannot know about.

### The room's own settings

**Also take this campaign's room name, theme and switches** is off by default,
and applies `room.json` and `calendar.json` when you turn it on. Leave it off
when you are adding material to a room that is already running — renaming a room
and moving its calendar out from under the people at the table is startling.

## What never travels

A campaign is prepared material, not a save file. It carries none of this:

- your players, their accounts, or who is a member of the room;
- characters, or anything on a character sheet;
- the chat log, dice rolls, or what is currently on screen;
- which encounter is running.

An imported encounter always arrives **prepared, not running**.

## When a campaign is too big

Maps and music are the whole of a campaign's size; everything else is kilobytes.
If one will not upload, split it into parts that share a `campaignId` in their
manifests — the material in one, the art in another — and import them one after
the other. They land in the same room and the room treats them as one campaign.

If the upload fails before the application says anything at all, the server is
probably behind a reverse proxy with its own limit; whoever runs it will find
that in the [deployment notes](../../deployment.md).

## Next

- [Room Config](room-config.md) — the panel this lives in, and everything else it holds.
- [NPCs and encounters](npcs-and-encounters.md) — what an imported cast and an imported fight become.
