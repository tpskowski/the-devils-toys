# 3D dice roller — implementation plan

Status: Phase 1 implemented, 2026-09-23. The original design rationale follows; the resolved choices below describe the delivered behavior. Texture packs remain Phase 2.

## Phase 1 decisions

- The server selects results with cryptographic randomness. A lazy-loaded Three.js renderer tumbles fixed, numbered meshes into the selected landing orientation; no physics server is needed.
- Rooms start with 3D dice off. Personal animation starts on and is saved per account across rooms and devices. The default set follows the room theme; a named set or custom palette stays fixed. Authorized viewers see the roller's colors.
- All thirteen requested shapes, percentile tens, full percentile pairs, and existing d44/d66 digit pairs are supported. Odd dice use barrels with repeated labels, d4 reads its upper tip, d14 uses a trapezohedron, d16/d24 use bipyramids, and d30 uses a rhombic triacontahedron.
- `d%` aliases the full `d100` roll. `d%10` rolls the tens die alone, from 00 through 90.
- The overlay is clipped to the main media panel. Phones use the active Chat/Combat panel when the scene is hidden, excluding the composer. It remains visible over dialogs while allowing all pointer input through.
- Roll groups play sequentially with a bounded visual queue. Stale effects are discarded using local receipt time, so mismatched device clocks cannot hide fresh rolls. Text and game-state writes are immediate and independent of animation.
- Custom dice are declarative numeric definitions: built-in templates or validated convex geometry, with repeated numeric values supported. Each roll carries a validated definition snapshot so an in-flight roll survives a system update. Selection is through the dice picker or roll API; custom expression syntax and symbol rules are outside Phase 1.
- Reduced motion, unavailable WebGL, and context loss preserve textual results. There are no dice sounds or image textures in this phase.

See [the player guide](guide/rolling-dice.md) and [custom-dice authoring](guide/admin/custom-dice.md) for the supported controls and data format.

## Direction

Keep the server authoritative for randomness and rules. Render the resulting dice on each eligible viewer's device, inside the main scene area. Animation is presentation: a failed renderer, disabled animation, or slow device must never change or postpone a game-state write.

Use a small, lazy-loaded Three.js renderer with app-owned geometry and face mappings. Start with controlled tumbling, bounces, and a final orientation derived from the server-selected face. A client-side physics worker remains an option if the motion prototype needs it; server-side physics is not recommended. It adds simulation and synchronization costs without helping when clients have different viewport bounds and outcomes are already determined.

Before committing to the motion implementation, demonstrate a convincing d6, readable d4, odd-sided die, d30, and percentile pair. No visible last-frame snapping, relabeling of moving faces, or rejection-sampling physical throws until a desired number appears. Existing dice libraries can be evaluated during this spike, but adoption depends on support for the entire shape list, fixed face mappings, prescribed outcomes, custom definitions, licensing, and mobile performance.

## Repository baseline before Phase 1

- `server/src/dice.ts` generates individual results, totals, keep/drop selections, and formatted detail. Its default randomness is `Math.random`; its injectable random source supports deterministic tests.
- `shared/src/roll-tables.ts` owns `SUPPORTED_DIE_SIDES`. It currently includes 100, 66, 44, 30, 20, 12, 10, 8, 6, 5, and 4. Add 24, 16, 14, 7, and 3 here, preserving descending order.
- d44 and d66 are compound digit-pair rolls, not 44- and 66-faced solids. Their existing behavior must survive.
- `server/src/index.ts` serves both `/rolls` and chat `/r` commands. Public messages currently contain formatted text rather than a complete per-die description.
- `server/src/tables.ts` rolls table sequences and deliberately filters their audiences. In particular, a table roll called `public` sends players only a notice; `reveal` shares the actual result.
- `client/src/DiceModal.tsx` has a separate hard-coded die picker. Replace that duplication with shared descriptors while preserving mode-specific choices.
- `client/src/App.tsx` receives room events and renders `.scene-stage` around the main media viewer. The mobile layout hides this stage while Chat or Combat is active.
- `server/src/realtime.ts` distinguishes room participants from Room Config watchers. Watchers do not receive chat or rolls; a new animation event must preserve that distinction.
- System imports strictly validate declarative `system.json`. Repository discovery currently accepts only the marker, definition, catalogues, rules, and tables. Merely adding a model/image directory will not install it.

## Phase 1 product behavior

### Room and personal controls

- Add a GM-controlled `dice3dEnabled` room setting, off by default for both new and existing rooms.
- Add a personal animation preference for GM and players, on by default. Effective animation requires both the room setting and personal preference to be on.
- Turning a room off does not erase anyone's colors or opt-out. Turning it back on does not override an explicit opt-out.
- Propose account-level persistence across rooms and devices, subject to the user's answer. Store preferences in the configured database and validate writes against the signed-in account.
- Provide body color, number color, automatic contrasting numbers, and one initial dice set for each existing app theme. A live sample die makes the choice visible. The user confirmed theme-matched sets with inverted light/dark balance instead of the originally proposed generic presets.
- Derive the sets from the authoritative palettes in `shared/styles/theme.css`: light themes get dark dice, and dark themes get light dice. Use the theme's text color for the body, background color for numerals, and accent color for restrained edge/trim details. This is a palette-role swap, not an RGB complement; it preserves the theme's character and readable numbers.
- Keep all six sets available to everyone alongside custom colors. Proposed initial selection: the set matching the roller's effective app theme. Once explicitly selected/customized, a dice appearance stays selected when the room theme changes. A shared roll carries that resolved appearance rather than allowing each recipient's theme to recolor it.

| App theme / initial dice set | Body                      | Numerals              | Accent              | Proposed finish |
| ---------------------------- | ------------------------- | --------------------- | ------------------- | --------------- |
| Heroic Tales                 | Near-black `#191914`      | Parchment `#e7e3d7`   | Brick red `#b63e2e` | Satin           |
| Digital Future               | Ice white `#e9f9ff`       | Deep navy `#071018`   | Cyan `#18e1d1`      | Gloss           |
| Used Universe                | Dark brown-grey `#2d2b25` | Warm sand `#c9c0ad`   | Rust `#9a4c2f`      | Matte           |
| Grim Adventure               | Bone `#e4e0d7`            | Charcoal `#171717`    | Crimson `#9f2634`   | Matte           |
| Get in the VTT Shinji        | Pale lavender `#ebe6f7`   | Deep violet `#1d1a2f` | Lime `#8bd450`      | Gloss           |
| Production Type              | Pale blush `#fbe5e5`      | Dark plum `#291d2d`   | Orange `#ea8532`    | Satin           |

These are Phase 1 colors and material finishes only. Check number readability under the actual 3D lighting and use a subtle outline/shadow so light or dark scene artwork does not swallow the dice. Accent details must not replace contrasting numerals. Phase 2 textures can extend the same six sets.

- Proposed shared behavior: public rolls display the roller's chosen appearance for everyone; a viewer's opt-out suppresses all 3D animation on that viewer's device only.
- Respect reduced-motion preferences with a static/brief result presentation. Missing WebGL or context loss falls back to existing textual results.
- Sound is outside the initial scope unless requested.

### Bounded overlay

- Attach one transparent canvas to the visible main content bounds, clipped to that area. It must not spill into the header, navigation, chat rail, or controls.
- Dice have an inset floor and walls, sized from the current element bounds. Resizing, rail expansion, fullscreen media, and orientation changes update those bounds.
- Dice stay in screen space while maps pan and zoom. They do not collide with map tokens or terrain.
- The canvas does not intercept pointer input. Existing modals remain interactive and above it; active modal rolls need explicit placement review so the result is not entirely obscured.
- Proposed phone behavior: when the scene is hidden, use the active Chat/Combat content area, excluding navigation and the composer. Never switch tabs just to show a roll. This is an explicit extension of the requested scene-only bounds to confirm.
- Target roughly 1–1.5 seconds of motion, a short settled pause, then a fade. Allow overlapping small roll groups; use bounded visual batching for bursts and long table chains. Never drop or cap actual roll results to manage animation load.
- Load 3D code only when needed, stop the render loop when idle, and release resources on room exit. Discard stale queued effects when hidden, disabled, or leaving a room.

### Dice and results

| Dice            | Proposed representation                                                                    |
| --------------- | ------------------------------------------------------------------------------------------ |
| d3              | Three-result prism/barrel shape with non-result ends                                       |
| d4              | Tetrahedron; use a consistent tip-reading numeral arrangement                              |
| d5, d7          | Five-/seven-result prism/barrel shapes with non-result ends                                |
| d6              | Cube, numbered faces                                                                       |
| d8              | Octahedron                                                                                 |
| d10             | Ten-sided trapezohedron, 1–10 for ordinary rolls                                           |
| Percentile tens | Same ten-sided shape with 00, 10, …, 90                                                    |
| d12             | Dodecahedron                                                                               |
| d14, d16        | Fourteen-/sixteen-face bipyramidal or trapezohedral forms, chosen after readability review |
| d20             | Icosahedron                                                                                |
| d24, d30        | Distinct 24-/30-face models with sufficiently large, legible number regions                |

Odd dice have several physical conventions; the proposed forms need visual review. A three-result die need not literally have only three geometric faces. Non-result end caps must never be selected as landing outcomes. Since the server selects results uniformly, physical shape does not determine probabilities.

- Every built-in die uses numbers, never pips. Distinguish 6 and 9 clearly.
- A d100 result is visualized as a tens die plus a units die, with 00 + 0 meaning 100. Ordinary d10 keeps its existing 1–10 semantics; percentile units display 0–9.
- Do not silently overload notation: propose retaining `d100` for a full percentile roll and making `d%10` an explicit tens die. The user's use of `d%` for the tens die needs confirmation because that name is also commonly used for a complete percentile roll.
- d44 and d66 display two d4s/d6s with explicit tens/units roles.
- Show all dice involved in keep/drop rolls and mark the dropped dice after settling. A modifier is shown in text; it is not an extra die.
- Preserve die identity when equal values appear in keep/drop rolls. The current value-only arrays are insufficient to distinguish those cases without the selected indexes.
- Share results and appearance across viewers; do not require identical trajectories or wall-clock synchronization across different screen sizes.

## Structured roll delivery

Introduce a versioned shared roll presentation structure rather than parsing `ChatMessage.body` or `detail`.

Each live roll carries a unique event id, room id, roller identity, timestamp, source/context, appearance snapshot, expression/total/modifier, and a list of individual dice. Each die identifies its definition, chosen face index, numeric value, keep/drop state, and any compound group/role. Include a visual-only seed independent of the RNG used for future game outcomes.

Return the same presentation id through the HTTP response and any authorized live event. The client deduplicates by that id. HTTP remains sufficient for the initiating viewer when their socket is reconnecting; it must not animate twice when both paths succeed. Historical chat loading never triggers new animations.

Resolve the audience on the server using each roll route's existing rules:

- Ordinary public roll: room participants.
- Player private roll: roller and authorized GM viewers; other players receive only the existing notice, without dice, seed, or result metadata.
- GM private/invisible rolls: preserve the route's existing recipient behavior. No animation metadata goes to recipients who receive only a notice or nothing.
- Table rolls: preserve the difference between `public` (notice only to players), `reveal`, `private`, and `invisible`. Do not apply the ordinary public-roll rule by visibility string alone.
- Room Config watchers and player-preview polling do not become live dice subscribers.

Prepare the roll once on the server and reuse its values for mechanics, persistence, response, and animation. Use a cryptographically strong server random-integer source for production rolls while retaining deterministic injection for tests; audit creation and table callers that currently supply `Math.random` so behavior is intentional and consistent. No client-submitted face result is trusted.

Integrate explicit in-room rolls: the dice modal, chat commands, sheet saves, checks, damage/weapon actions, and table sequences. Audit attribute damage and initiative for their own delivery paths. Character creation also uses `rollDice`, but character-manager rolls outside a room have no room scene or audience: include room-scoped creation only where context and access are explicit, and keep out-of-room creation textual in this phase. Do not broadcast globally from the low-level dice function.

## Custom dice from system imports

Proposed Phase 1 scope, pending clarification: numeric custom dice, including new supported shapes and repeated numeric face values. Symbol resolution rules require a separate declarative design if requested.

- Add an optional versioned dice declaration to `system.json`. Built-in dice remain application capabilities; this does not create a systems workspace or require a system to enable 3D.
- Namespace custom ids by system. A declaration names a built-in shape template and parameters, or a bounded convex geometry definition using finite vertices and polygon faces. Include label placement and result-face mapping; the renderer derives/validates landing orientations from geometry.
- Distinguish geometric faces, eligible outcome faces, displayed labels, and numeric values. Uniform selection is over eligible outcome faces, so repeated numeric values naturally have repeated probability. No arbitrary probability scripts or functions.
- Define how a custom die is selected and rolled, not just rendered. Use an explicit custom definition id in the roll request and picker; keep existing standard notation stable. Extend expressions/table or creation references only through a documented shared resolver, with server-side system-context validation.
- Validate convexity, topology, nondegenerate faces, finite coordinates, face references, label lengths, count/size limits, and complete result mappings during install and `systems:validate`. Every outcome must have a usable settled pose.
- Keep geometry inline in `system.json` initially so repository, upload, export, and atomic install use the existing content path. No executable code, shader source, or remote asset URLs.
- Include the new definitions in install cache invalidation. An in-flight roll uses a definition revision/hash to avoid landing against a newly replaced face map; if the matching definition is unavailable, fall back to text rather than show a wrong die.
- Extend the published JSON Schema and author documentation. Toybox declares custom dice and plainbox omits them; both go through real installs. Test install replacement, rejection, export/import, and fallback after an update removes a definition.

## Phase 2: texture packs

Separate three concerns from day one: geometry, face labels, and surface material. This lets one texture work across many shapes and keeps generated artwork from controlling outcome labels.

Proposed portable texture standard:

- A seamless square PNG or WebP base-color image, normally 1024 × 1024, with no numbers, lighting, perspective, shadows, or painted highlights.
- Optional roughness, normal, and metallic maps with documented channel and color-space conventions. These are separate assets, not assumed to be correct because the color image looks good.
- A small versioned manifest with id, name, author/license, local asset paths, scale/orientation, default number color, and material defaults.
- Defined UV coordinates for every supported geometry and test renders on multiple shapes. A seamless source image still needs seam and distortion review on the actual die.
- Generate/render numerals separately, with sufficient contrast and safe margins. Per-face illustrations or logos require a shape-specific face atlas and can follow later.
- Validate file signatures, decoded dimensions, total pack bytes, and local paths at import. Extend repository discovery, bundles, staging, export, serving, and cache invalidation together when images are introduced. Preserve redirect checks and existing archive protections.

GPT Image 2.5 can produce texture artwork; elsewhere-authored artwork should use the same pack standard. Image generation here does not expose an explicit model selector, so an exact GPT Image 2.5 model cannot be promised through that tool. If exact selection matters, the OpenAI API documents `gpt-image-2.5-sunburst` and `gpt-image-2.5-flare`. Generation is an authoring workflow, not a runtime connection from the tabletop server.

## Delivery order and validation

1. **Motion/geometry spike:** representative shapes, fixed outcome mapping, bounded scene, viewport resize, readable numerals, and phone performance. Exit only once the difficult shapes and prescribed landings look acceptable.
2. **Roll contract and preferences:** structured per-die results, strong server RNG, recipient filtering, deduplication, room switch, personal settings, and guarded/idempotent database changes. Old clients/messages remain usable.
3. **Complete standard set and integration:** all requested sizes, percentile and compound dice, keep/drop, every scoped roll entry point, presets, mobile behavior, reduced motion, and rendering fallbacks.
4. **Declarative system dice:** shared resolver, import validation, generated schema, real fixture installs, export round-trip, definition-update behavior, and author examples. This is part of Phase 1, not postponed behind textures.
5. **Phase 1 release checks:** targeted shared/server tests and browser tests, migration regression, typecheck/build, then relevant project checks. Update `changelog.md` and the rolling-dice guide.
6. **Phase 2 texture packs:** implement the agreed pack format and end-to-end import/export/serving path; generate sample materials and inspect them on the actual meshes.

Required regression coverage includes every face of every die mapping to the correct settled result; d100 boundaries; d44/d66; tied keep/drop values; mixed audiences and hidden table chains; HTTP/socket duplicate delivery; reconnection without history replay; room toggle and persistent opt-out; cross-system custom definition rejection; invalid imports preserving the installed version; rendering failure preserving the textual result; phone layout and nonblocking pointer interaction.

Do not use pixel-perfect snapshots of arbitrary live physics as the correctness test. Test result/orientation invariants and deterministic presentation fixtures, then inspect representative animations visually.

## Original decision points, now resolved above

1. Custom imports: only standard-die appearance variants, new numeric shapes/mappings, or symbols and special result rules?
2. Shared appearance: should authorized viewers see the roller's colors, and all public rolls?
3. Persistence: account-wide, room-specific, or device-local preferences?
4. Percentile naming: reserve `d%` for a complete percentile roll and use `d%10` for tens, or follow the requested tens-only meaning for both?
5. Phone fallback: active Chat/Combat content area when the scene is hidden, or no animation until the scene is visible?

## Technical references

- [Three.js standard materials](https://threejs.org/docs/pages/MeshStandardMaterial.html): color, roughness, metallic, and normal-map capabilities.
- [Dice Box Three.js](https://github.com/3d-dice/dice-box-threejs): existing renderer candidate to assess during the spike, not a selected dependency.
- [GPT Image 2.5 Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst): official model documentation.
