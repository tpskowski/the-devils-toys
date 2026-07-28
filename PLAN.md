# Cairn/Monolith VTT Implementation Plan

This project is a custom virtual tabletop for Cairn and Monolith. They share a core rules lineage, but Cairn is fantasy and Monolith is science fiction.

## How to use this plan

- **Guidelines** are enduring product and engineering constraints. They are not tasks and are not crossed off.
- **Feature checklists** contain implementable, verifiable work. Change `[ ]` to `[x]` only after the feature and its acceptance notes are implemented and tested.
- **Deferred feature backlog** contains work that is explicitly outside the first-release scope.

# Implementation guidelines

## Product scope and terminology

- A **system** is the rules and system-specific content for one TTRPG.
- A **room** or **game** is a persistent space in which one GM and a group of players share sessions.
- Local hosting is the default. Public-cloud operation needs readiness and documentation, but a managed cloud deployment is not a first-release requirement.
- The first release should be a robust, practical application rather than only a thin end-to-end prototype.
- A room's theme may change after creation, but its selected game system may not.

## Architecture and deployment

- Use a TypeScript monorepo with a React/Vite client, a Node.js server, WebSockets for live room updates, and SQLite for persistent data.
- In production, one Node.js process serves the built client and the API.
- Install game systems at build time from repository folders. Runtime system installation is deferred.
- Support ordinary local hosting on Windows, macOS, and Linux equally in the first release.
- Store all mutable data beneath one configurable directory so the installation can be backed up easily.
- Support room rosters of one GM and up to 20 player accounts, with up to 10 players active in a session. These are supported operating targets, not hard limits unless a technical constraint requires enforcement.

## Systems and source content

- Keep Cairn and Monolith data/configuration in separate per-system files or folders. Prefer JSON where practical.
- Use a common data shape where it fits, but do not force system-specific concepts into an unsuitable shared model.
- When adding a system, follow the guidance in `AGENTS.md` under `Adding new systems`.
- Treat Markdown files in `/raw` as the primary rules sources. Use the matching PDFs to verify questionable formatting or content.
- Preserve imported rules wording exactly except for obvious encoding and formatting repairs.
- Apparent source typos may be corrected only when the original and correction are recorded in `/raw/corrections.md` with the source and reason.
- Prefer warnings for derived values and rules constraints. Define hard limits only where they make sense for the individual game system.

## Security, privacy, and data ownership

- Accounts exist only within one server installation; there is no cross-server identity.
- Enforce role-based content access on the server. Player searches, suggestions, snippets, and direct requests must not expose GM-only material.
- Collect no telemetry by default.
- Structured local logs must redact passwords, tokens, secrets, and other sensitive values automatically.
- Without email integration, password recovery requires another GM/admin or direct server-host intervention.
- A character used in multiple compatible rooms is one live record; changes apply everywhere the character appears.

## Presentation and compatibility

- All four developer-authored themes are available to both systems.
- Bundled web fonts are allowed when their licenses and attribution notices are included.
- Player features must be highly responsive and work well on phones.
- GM features are desktop-first. Core GM actions must remain functional on mobile, but full mobile parity is not required.
- WCAG AA certification and a formal browser-support matrix are not first-release targets.

## Licensing and operations

- License project code under MIT.
- Clearly note that bundled rules text remains covered by CC BY-SA 4.0 as identified by the source material in `/raw`.
- Include licenses and attribution for bundled fonts and other third-party assets.
- Use a documented filesystem backup procedure for the first release; in-app export/import is deferred.

# First-release feature checklist

## Project foundation and operations

- [x] **Initialize and scaffold the repository.**
  - Initialize Git and add an appropriate `.gitignore`.
  - Add `README.md`, `AGENTS.md`, the MIT license, `credits.md`, `changelog.md`, and `roadmap.md`.
  - Add the `Adding new systems` guidance to `AGENTS.md`.
- [x] **Create the TypeScript monorepo.**
  - Include the React/Vite client, Node.js server, shared types/packages, and consistent development scripts.
- [x] **Build the single-process production application.**
  - The Node.js server serves the compiled client and API from one process.
- [x] **Add WebSocket-based live updates.**
  - Reconnect clients without losing persistent session state.
- [x] **Add SQLite persistence.**
  - Persist accounts, rooms, memberships, characters, chat, private roll history, media metadata, and other user-generated state.
- [x] **Add a configurable mutable-data directory.**
  - Keep the database, uploads, logs, and other mutable files beneath it.
  - Make the total upload-storage allowance configurable by the server host.
- [x] **Support local startup on Windows, macOS, and Linux.**
- [x] **Add first-release container support through WSLC and Docker-compatible tooling.**
  - Keep ordinary Node.js startup available alongside Docker.
- [x] **Document cloud-ready deployment.**
- [x] **Document filesystem backup and restore.**
- [x] **Add structured local logging.**
  - Provide configurable levels and automatic sensitive-value redaction.
- [x] **Add GitHub Actions CI.**
  - Run formatting checks, type checks, unit tests, production builds, and end-to-end smoke tests.
- [x] **Expose project information in the application.**
  - Render `credits.md`, `changelog.md`, and `roadmap.md` in modal views.

## Accounts and authentication

- [x] **Add one-time initial server setup.**
  - The first visitor creates the initial GM/admin account.
  - Disable the setup route after successful initialization.
- [x] **Add username/password authentication and logout.**
  - Do not provide guest links or passwordless guest sessions.
- [x] **Support room-specific roles.**
  - One account may be a GM in some rooms and a player in others.
- [x] **Allow GMs/admins to create player accounts.**
  - Public self-registration is not available.
- [x] **Create player invite links.**
  - Links are single-use, revocable, and expire after 30 days.
  - Each link targets an account created by a GM/admin and grants membership in its room.
- [x] **Add invite redemption and password setup.**
  - The invited player sets the account password.
  - Successful redemption grants ongoing room membership; the link is not needed again.
- [x] **Add host-assisted password recovery.**
  - Permit recovery by another GM/admin or by documented direct host intervention.

## Room management

- [x] **Create rooms with a selected system and theme.**
  - Offer Cairn and Monolith.
  - Allow later theme changes but not system changes.
- [x] **Add room archive and deletion workflows.**
  - Normal removal archives the room.
  - Permanent deletion is a separate admin action.
- [x] **Add room membership management.**
  - A GM can add and remove player accounts from the room.
- [x] **Enforce one active GM per room for the first release.**
  - Keep the role model extensible for future co-GMs.
- [x] **Add the GM room switcher.**
  - Switching the GM's active room does not affect room-specific player access or links.
- [x] **Verify supported room capacity.**
  - Test rosters up to 20 player accounts and sessions up to 10 active players without imposing unnecessary hard limits.
- [x] **Build GM administration screens.**
  - Provide practical controls for rooms, players, and player characters.
- [x] **Add pre-session company management for GMs and admins.**
  - Create player accounts before assigning them to rooms and reset their passwords when needed.
  - Create character records independently of room and player assignment.
  - Assign players and characters only within rooms the current GM is authorized to manage.

## Characters

- [x] **Add manual Cairn and Monolith character sheets.**
  - Match the source sheets.
  - Keep fields directly editable without automated validation or sheet-based rolling in the first release.
  - Automatically save editable character fields without a manual save action.
  - Confirm before backdrop-discarding a newly created character.
  - Allow editable player characters to upload, replace, and remove a PNG, JPEG, or WebP portrait up to 5 MB.
- [x] **Associate multiple characters with one player account.**
  - Permit a compatible character to move between rooms and GMs.
- [x] **Create per-room pools of unassigned GM-created characters.**
- [x] **Add the first-join character choice flow.**
  - Create a character, select an already owned compatible character, or claim an unassigned room character.
- [x] **Allow character switching within a room.**
  - A player controls only one character at a time.
- [x] **Show active character identity throughout a room.**
  - Present assigned participants in live room surfaces as `Character Name (account name)`.
- [x] **Open assigned character sheets from the People list.**
  - Other participants' active sheets are visible to the room but remain read-only to players.
- [x] **Give the room GM full character access.**
  - The GM can view and edit every character in the room.
- [x] **Use live character data across compatible rooms.**
  - Damage, inventory, and other edits propagate everywhere.
  - The same character may be active in multiple rooms simultaneously.
- [x] **Implement character claiming and unassignment.**
  - Claiming grants ongoing player ownership.
  - The GM can unassign ownership and return the character to that room's unassigned pool.
- [x] **Add system-specific constraint feedback.**
  - Show warnings by default and enforce only explicitly configured per-system hard limits.

## Presence and connections

- [x] **Show role-appropriate presence.**
  - GMs see room members as online or offline and receive join/leave messages.
  - Players see which players are online but do not receive join/leave messages.
- [x] **Support multiple active tabs per account.**
  - A newer connection does not replace an older one.

## Chat and dice

- [x] **Add persistent room chat.**
  - Preserve history indefinitely until it is cleared.
- [x] **Add permanent GM chat clearing.**
  - Clearing deletes the messages rather than archiving or hiding them.
- [x] **Prevent player message editing and deletion in the first release.**
- [x] **Add the dice modal.**
  - Offer d4, d6, d8, d10, d12, d20, and d100.
  - Default to one die and permit multiple dice.
  - Post public roll results to room chat.
- [x] **Add typed dice commands.**
  - Support `/r` and `/roll`, including expressions such as `/roll 2d6+1`.
- [x] **Implement system-defined dice mechanics.**
  - Include the advantage/disadvantage, keep/drop, and modifier behavior required by Cairn and Monolith.
  - Keep the parser extensible for later systems.
- [x] **Add private GM rolls.**
  - Only the GM can see them.
  - Persist private roll history across reconnects.

## Maps, Scenes, and References

- [x] **Add image upload and paste support.**
  - Accept PNG, JPEG, and WebP.
  - Reject GIF.
  - Enforce a default 60 MB Scene limit and 20 MB Reference limit.
  - Let the GM classify each image as a Map, Scene, or Reference.
- [x] **Add current Map selection.**
  - Only one Map is active at a time, and players see the GM-selected Map.
- [x] **Add current Scene selection.**
  - Only one Scene is active at a time, and players see the GM-selected Scene.
- [x] **Add Scene viewing controls.**
  - Fit the entire image by default and support zoom and pan.
- [x] **Add Scene pings.**
  - Show pings to the room, remove them after roughly 2-3 seconds, and do not retain them in history.
- [x] **Add explicit Reference reveal.**
  - A Reference becomes visible only after the GM reveals it.
  - Revealed References remain in each player's Reference list.
- [x] **Add the player Reference viewer.**
  - Open, close, and browse previously revealed References.
- [x] **Remove References from player history independently.**
  - Do not delete the underlying uploaded file when removing a history entry.

## Audio

- [x] **Add MP3 upload and a simple playlist.**
  - Enforce a default 50 MB per-MP3 limit.
- [x] **Add synchronized GM-controlled playback.**
  - Synchronize play, pause, seek position, and track selection closely across the room.
- [x] **Synchronize late joiners.**
  - Begin at the current shared track position.
- [x] **Add local player audio controls.**
  - Each player has independent volume and mute controls.
- [x] **Keep shared audio controls contextual.**
  - Hide the Now Playing dock until the room has an MP3, while retaining the GM upload control.
  - Allow the Now Playing dock to collapse without interrupting playback.

## Rules and system content

- [x] **Create separate build-time system packages for Cairn and Monolith.**
- [x] **Import Cairn rules and player-facing content from `/raw`.**
  - Preserve wording according to the source-content guidelines.
- [x] **Import Monolith rules and player-facing content from `/raw`.**
  - Include starships, factions, generators, psionics, implants, and similar material as reference content only.
- [x] **Create and maintain `/raw/corrections.md`.**
  - Record every intentional apparent-typo correction with its source, original text, correction, and reason.
- [x] **Add contextual rules pop-ups.**
  - Link relevant rules from character sheets and other interfaces.
  - Preview authorized character-sheet rules on hover, pin them on click, and dismiss them with an outside click.
- [x] **Add the full-page Markdown rules reference.**
  - Include a navigable `#` and `##` heading index beside the expanded rules on larger screens and above them on phones.
  - Hide source-document front matter from the rendered rules, heading index, and rules search.
- [x] **Add comprehensive system-content search.**
  - Open the same authorized reference in a dedicated per-system browser path.
  - Index rule prose, equipment, spells, backgrounds, monsters, and tables.
- [x] **Enforce role-filtered rules access.**
  - GMs can search all content for the room's system.
  - Players cannot discover or retrieve monsters, GM tables, or other GM-only content through search results, snippets, suggestions, or direct access.
- [x] **Add in-application rules links and cross-references.**

## Themes and responsive presentation

- [x] **Build the standardized per-room theme system.**
  - Themes control colors, fonts, box design, and related presentation choices.
  - Make every bundled theme selectable for either Cairn or Monolith.
- [x] **Implement Digital Future.**
  - Dark black/deep-blue base, neon accents, bold colors, and a cyberpunk/1980s-digital feel.
- [x] **Implement Used Universe.**
  - Light gray/brown palette with worn, dingy, western, and used-space-opera influences.
- [x] **Implement Heroic Tales.**
  - Light heroic-fantasy presentation using red and green accents, white backgrounds, black text, and restrained gothic/medieval fonts.
- [x] **Implement Grim Adventure.**
  - Dark gray base with more ornate gothic and medieval typography.
- [x] **Set system theme defaults.**
  - Cairn defaults to Heroic Tales.
  - Monolith defaults to Digital Future.
- [x] **Bundle and document web fonts.**
  - Include required licenses and attribution notices.
- [x] **Make all player features phone-responsive.**
- [x] **Keep core GM features functional on mobile.**

## GM content tools

- [x] **Add the NPC and monster catalog.**
  - Include base monsters from the rulebooks.
- [x] **Allow GMs to create custom NPCs and monsters.**
  - NPCs are named non-player characters; monsters may represent reusable nameless adversaries.

# Character Stuff
- [ ] **Compact character sheet**
- [ ] **Add row of PCs at top of scene using portraits with name initial(s) as fallback**
- [ ] **fix inventory to show backpack vs equipped**
- [ ] **Make stuff clickable**

# NPCs
- [ ] **Add mini NPC character sheets with clickable stuff**
- [ ] **Allow adding them to combat scene**

# UI
- [x] **Add tabs to the main display for Maps, Scenes, and References**
- [x] **Allow Markdown text uploads as References**
- [ ] **Add toggleable combat UI**
- [ ] **Add character token support/movement**

# Deferred feature backlog

These features are intentionally not required for the first release.

- [ ] **Support multiple active/co-GMs in one room.**
- [ ] **Install new game systems dynamically on a running server.**
- [ ] **Add dedicated mechanics and automation for Monolith starships, factions, generators, psionics, implants, and similar subsystems.**
- [ ] **Add guided or automated character creation.**
- [ ] **Add automated character-sheet rolling and broad rules validation.**
- [ ] **Allow users to create custom themes.**
- [ ] **Add in-app backup export/import.**
- [ ] **Bring the complete GM interface to mobile parity.**
