import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { projectFile } from "./paths.js";

/**
 * Nothing a running server was given may be committed.
 *
 * This is a licensing boundary rather than a tidiness one. An installed system
 * carries its publisher's rulebook; a room's Library carries whatever a table
 * uploaded; the database carries both. None of it is this repository's to
 * publish — and all of it arrives as files on disk rather than as a commit
 * somebody reviews, which is exactly the kind of thing that gets added by a
 * hurried `git add -A`.
 *
 * `.gitignore` is what stands between those two facts, so it is worth a test.
 * The paths below are the ones the application actually writes, and the second
 * half of this file is the other half of the promise: that the rules are not so
 * broad they hide the repository's own work.
 */

/** `git check-ignore` answers for paths that need not exist, which is what this needs. */
function ignored(candidate: string) {
  try {
    execFileSync("git", ["check-ignore", "-q", "--no-index", candidate], { cwd: projectFile(".") });
    return true;
  } catch (cause) {
    // Exit 1 is "not ignored" and is an answer; anything else is git failing.
    const status = (cause as { status?: number }).status;
    if (status === 1) return false;
    throw cause;
  }
}

describe("what a running server writes is never committable", () => {
  it.each([
    // The default data directory, and everything an install and an import put in it.
    [".data/devils-toys.sqlite"],
    [".data/systems/cairn/system.json"],
    [".data/systems/cairn/rules/Cairn.md"],
    [".data/systems/cairn.incoming/rules/Cairn.md"],
    [".data/systems/cairn.replaced/rules/Cairn.md"],
    [".data/uploads/9f1d2c3b-4a5e-6f70-8192-a3b4c5d6e7f8.png"],
    [".data/imports/9f1d2c3b-4a5e-6f70-8192-a3b4c5d6e7f8/files/maps/the-keep.png"],
    [".data/logs/server.log"],
    // A data directory pointed somewhere else with DEVILS_TOYS_DATA_DIR.
    [".data-preview/systems/cairn/rules/Cairn.md"],
    [".data-local/devils-toys.sqlite"],
    ["data/devils-toys.sqlite"],
    ["server/.data/systems/cairn/rules/Cairn.md"],
    // The database, wherever somebody has put it.
    ["somewhere/else/devils-toys.sqlite"],
    ["somewhere/else/devils-toys.sqlite-wal"],
    // What the application hands out, downloaded into the checkout.
    ["cairn.devilsystem.zip"],
    ["docs/tomb-of-the-serpent-kings.devilcampaign.zip"],
    // A system exported with an --out inside this checkout.
    ["devils-toys-cairn/system.json"]
  ])("ignores %s", (candidate) => {
    expect(ignored(candidate)).toBe(true);
  });
});

describe("and the rules are no broader than that", () => {
  /**
   * The other half. A rule that hid the fixtures' own rulebooks, or the guide,
   * would pass every test above and quietly stop this repository tracking its
   * own work — so the things that look like the things being excluded are named
   * here on purpose.
   */
  it.each([
    ["fixtures/toybox/rules/Toybox.md"],
    ["fixtures/plainbox/rules/Plainbox.md"],
    ["fixtures/toybox/tables/toybox.json"],
    ["docs/guide/gm/campaigns.md"],
    ["docs/guide/images/gm-tables.png"],
    ["raw/tables/repository-sets.json"],
    ["server/src/campaign-apply.ts"],
    ["README.md"]
  ])("still tracks %s", (candidate) => {
    expect(ignored(candidate)).toBe(false);
  });
});
