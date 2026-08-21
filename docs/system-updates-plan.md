# System versions and updates

A plan for three things Management → Systems cannot do today: say which version
of a system is installed, say when a newer one exists, and install it.

The catalogue menu already does two of them — it shows a version beside each
entry and offers **Update to 1.2.0** where the catalogue's version differs from
what was installed. None of that reaches the **installed** list, and none of it
works at all for a system installed straight from a repository or from a file,
because the version it compares comes from the catalogue entry rather than from
the system.

That is the hole this fills. **A system declares its own version**, the way it
declares everything else about itself, and the catalogue becomes one reader of
that rather than the authority on it.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **`devilsystem.json` gains `version`.** The marker is what a repository puts at its root to say it is a system; a release version belongs there beside the id and the licences. It travels with the system, so an uploaded bundle carries one exactly as a repository install does.                      |
| 2   | **It is optional, and a system without one is _unversioned_, not invalid.** Every system installed before today has no version and its rooms must keep working. `SYSTEM_REPO_VERSION` stays 1; adding an optional field is not a format change.                                                          |
| 3   | **The version is the author's word, not a computed one.** Nothing derives it from a tag, a commit, or a file hash. An author who never bumps it gets a system that never reports an update, which is the correct consequence of never releasing one.                                                     |
| 4   | **A newer version is claimed only when it is provably newer.** Where both sides read as dotted numbers, they are compared as numbers. Where either does not, the honest answer is _differs_, not _newer_ — a page that calls 2.0 an update to 10.0 is worse than one that says the two are not the same. |
| 5   | **The check reads the marker, not the system.** `raw.githubusercontent.com/<repo>/<ref>/devilsystem.json` is one small file on a host the allowlist already carries, because the catalogue is fetched from it. No tarball, no new host, no API.                                                          |
| 6   | **It runs when the page opens**, per system, and is cached on a TTL the way `fetchCatalog` already is. An admin who opens Systems expects to be told; being told requires asking.                                                                                                                        |
| 7   | **A failure is per system and says so.** One unreachable repository must leave every other row's answer intact. "I could not ask" and "there is nothing newer" are different answers, exactly as they already are for the catalogue as a whole.                                                          |
| 8   | **A system pinned to a commit is pinned, and is told so rather than checked.** A commit is immutable, so a check against one can never report anything. A system installed from a file has no upstream at all and says that instead.                                                                     |
| 9   | **Updating is installing, on the same path.** The button re-imports from the source already recorded against the row. Installing over an id is atomic and cache-invalidating today; a second install path would be a second thing to get wrong.                                                          |
| 10  | **An update is refused the same way any install is.** The eleven-plus checks in `refuseUninstallableBundle` / `refuseUninstallableCreation` run unchanged, so an update that would drop a sheet field in use fails and leaves the running system untouched.                                              |

### Assumptions, flagged so you can overrule them

- **No automatic updating.** Nothing installs itself. The server says a version exists; an admin presses the button.
- **No downgrade button.** Where the upstream version is older or not comparable, the row says so and offers **Reinstall**, which is what that action honestly is.
- **The catalogue keeps its `version` field.** It is a hint for a system that is not installed yet — the menu cannot read a marker for something nobody has fetched. Where a system _is_ installed, the marker wins.
- **Version strings are not validated as semver.** Authors write what they write; decision 4 is what makes that safe.

---

## What exists today

| Thing                             | Where                                              | State                                                                     |
| --------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| The marker                        | `SystemRepoMarker`, `server/src/system-repo.ts:44` | `app`, `formatVersion`, `systemId`, `systemName`, `licenses` — no version |
| What an install records           | `systems.manifest_json`                            | `{ version, source: { repository, ref, revision, fetchedAt } }`           |
| `version` on a repository install | `system-routes.ts:238`                             | `""` unless it came from the catalogue                                    |
| The installed list payload        | `publicSystem`, `system-routes.ts:71`              | Carries `source`, which carries `version` — the client ignores it         |
| Update detection                  | `/admin/systems/catalog`, `system-routes.ts:186`   | Catalogue entries only, never installed-list rows                         |
| The allowlist                     | `config.ts:77`                                     | Already includes `raw.githubusercontent.com`                              |
| A cached remote read              | `fetchCatalog`, `system-sources.ts:201`            | The TTL-cache pattern to copy                                             |
| The installed list UI             | `client/src/SystemsManagement.tsx:324`             | Shows `repository@ref`; no version, no update, no button                  |

**What is missing:** a version on the marker; a way to read one remote marker; a
per-system update answer on the installed list; and a button.

---

## The work

### 1. The marker declares a version

`SystemRepoMarker` and its schema gain an optional `version`. It is recorded into
`manifest_json` at install from the **marker** rather than from the catalogue
entry, with the catalogue's value as the fallback for a system whose marker has
none.

`buildSystemRepoMarker` cannot derive it: a `GameSystem` carries no version,
because a version is a statement about the repository's release rather than about
the definition. It is threaded in from the installed row instead, which is why
`writeSystemRepoDirectory` takes it as an argument and why `systems:export` reads
it off the row rather than out of `system.json`.

Every system repository beside this one gains a starting version, and so do both
fixtures — `toybox` versioned and `plainbox` deliberately not, so the pair goes
on telling "declared" and "left out" apart the way it does for everything else.

### 2. Reading one remote marker

`fetchSystemMarker(repository, ref)` in `server/src/system-sources.ts`, beside
`fetchSystemRepo` and built the same way: `fetchAllowed` → `readCapped` → the
marker schema. A sibling of `sourceArchiveUrl`:

```ts
markerUrl(repository, ref) === `https://raw.githubusercontent.com/${repository}/${ref}/devilsystem.json`;
```

Same `REPOSITORY_PATTERN` and `REF_PATTERN` refusals, for the same reason: a ref
must not be able to build a path.

### 3. Comparing two versions

`compareSystemVersions` in `shared/src/`, because the client shows the result and
the server decides it, and one reading is the whole of decision 4:

- Both dotted-numeric → numeric comparison, and `newer` only when strictly greater.
- Either not → `same` or `differs`, never `newer`.

### 4. The route

`GET /admin/systems/updates`, admin-gated like the rest, answering per system:

| Answer        | When                                                        |
| ------------- | ----------------------------------------------------------- |
| `newer`       | The marker at the stored ref reads as a later version       |
| `differs`     | It is different and not comparable                          |
| `current`     | Same version                                                |
| `pinned`      | The stored ref is a commit — immutable, so nothing to check |
| `unsourced`   | Installed from a file; there is no upstream                 |
| `unknown`     | One side or the other declares no version                   |
| `unreachable` | The fetch failed, with the reason                           |

Cached on a TTL, and one system's failure is that system's answer rather than the
route's.

### 5. The update itself

`POST /admin/systems/:systemId/update` re-imports from the source on the row and
goes through `installValidated` unchanged. It exists as its own route rather than
as a client that re-posts to `/import` so that the log line says what happened —
an update names the version it moved from and to.

### 6. The page

The installed list gains the version beside each system's name, the update state
as a quiet marker rather than a badge on every row, and an **Update to 1.2.0**
button where there is one — matching the catalogue menu's existing button, which
already reads exactly that way. `unsourced` and `pinned` rows say so in the line
that already says where the system came from.

---

## Phases

1. **The marker's `version`**, its schema, export round-trip, and recording it at install — **together with the catalogue fix below**, which is not separable from it. Recording the marker's version immediately breaks `/admin/systems/catalog`, whose `updateAvailable` compares the catalogue's string to the installed one for bare inequality: a catalogue entry carrying a book's version against a marker carrying a package's would offer an update that pressing the button could never satisfy, because the install writes the marker's version straight back. The marker therefore wins wherever a system is installed, which answers the third open question below by necessity rather than by preference.
2. **`fetchSystemMarker` and `compareSystemVersions`**, with tests, including the refusals.
3. **The route**, its cache, and its per-system failure handling.
4. **The page** — versions, states, and the button.
5. **The system repositories** declare their versions.
6. **Docs** — the admin guide's Systems page, `AGENTS.md`, `changelog.md`.

---

## Open questions

- **Does a room want to know?** A GM whose system updated under them might reasonably be told, and nothing today records that a room's system changed version. Out of scope, and the manifest already holds enough to add it later.
- **Should an update be refusable by usage?** An update that drops a sheet field in use is already refused by the installer. Whether an admin should be warned _before_ pressing, given room and character counts are already on the row, is a UI question rather than a safety one.
- **The catalogue's `version` may disagree with the marker.** Both are the author's, and a catalogue entry is the more likely to go stale. The marker wins where a system is installed; whether a disagreement is worth reporting to the admin is unresolved.
