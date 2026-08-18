import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  CAMPAIGN_BUNDLE_APP,
  CAMPAIGN_BUNDLE_VERSION,
  displayNameFromFile,
  readCampaign,
  refuseUnacceptableEntries
} from "./campaign-bundles.js";
import { extractZipEntries, readZipDirectory } from "./zip-safety.js";
import { removeDataDir } from "./test-setup.js";

/**
 * A campaign is read off a staged directory, so these tests build one — usually
 * by writing a zip and putting it through the real reader, because a directory
 * assembled by hand would not prove that the two halves agree about what a
 * bundle is.
 */
let workspace: string;
beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "devils-toys-campaign-"));
});
afterEach(() => {
  removeDataDir(workspace);
});

const limits = {
  maxBytes: 64 * 1024 * 1024,
  maxImageBytes: 60 * 1024 * 1024,
  maxAudioBytes: 50 * 1024 * 1024,
  maxEntries: 5000
};

const manifest = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    app: CAMPAIGN_BUNDLE_APP,
    bundleVersion: CAMPAIGN_BUNDLE_VERSION,
    campaignId: "tomb-of-the-serpent-kings",
    name: "Tomb of the Serpent Kings",
    version: "1.2",
    system: "cairn",
    exportedAt: "2026-08-16T00:00:00.000Z",
    licenses: ["CC BY-SA 4.0"],
    ...over
  });

/** Writes a bundle, reads its directory, and stages it exactly as an import would. */
function stage(files: Record<string, string>, name = "tomb.devilcampaign.zip") {
  const archive = path.join(workspace, name);
  fs.writeFileSync(
    archive,
    zipSync(Object.fromEntries(Object.entries(files).map(([file, body]) => [file, strToU8(body)])), { level: 6 })
  );
  const { entries } = readZipDirectory(archive, "campaign");
  refuseUnacceptableEntries(entries, limits);
  const directory = fs.mkdtempSync(path.join(workspace, "staged-"));
  extractZipEntries(archive, entries, directory, { maxBytes: limits.maxBytes, source: "campaign" });
  return directory;
}

const entriesOf = (files: Record<string, string>) => {
  const archive = path.join(workspace, `listing-${Math.random().toString(36).slice(2)}.zip`);
  fs.writeFileSync(
    archive,
    zipSync(Object.fromEntries(Object.entries(files).map(([file, body]) => [file, strToU8(body)])), { level: 6 })
  );
  return readZipDirectory(archive, "campaign").entries;
};

describe("what an archive has to look like to be a campaign", () => {
  it("accepts a bundle of nothing but maps", () => {
    expect(() => refuseUnacceptableEntries(entriesOf({ "maps/keep.png": "x" }), limits)).not.toThrow();
  });

  it("refuses a folder a campaign may not carry, naming it", () => {
    // The whole reason this check exists: `map/` would otherwise import cleanly
    // and contain no maps at all.
    expect(() => refuseUnacceptableEntries(entriesOf({ "map/keep.png": "x" }), limits)).toThrow(
      /holds a "map" folder, which is not one a campaign may carry/
    );
  });

  it("refuses a stray file outside any folder", () => {
    expect(() => refuseUnacceptableEntries(entriesOf({ "notes.txt": "x" }), limits)).toThrow(
      /holds "notes\.txt"\. A file outside a folder must be one of manifest\.json/
    );
  });

  it("refuses a file whose kind does not match its folder", () => {
    expect(() => refuseUnacceptableEntries(entriesOf({ "audio/dirge.png": "x" }), limits)).toThrow(
      /"audio\/dirge\.png" is not an MP3, which is what "audio" holds/
    );
    expect(() => refuseUnacceptableEntries(entriesOf({ "maps/keep.md": "x" }), limits)).toThrow(
      /"maps\/keep\.md" is not an image/
    );
  });

  it("refuses a nested folder rather than guessing what it meant", () => {
    expect(() => refuseUnacceptableEntries(entriesOf({ "maps/level-1/keep.png": "x" }), limits)).toThrow(
      /"maps\/level-1\/keep\.png" is nested/
    );
  });

  it("refuses one file larger than its kind allows, in megabytes", () => {
    const entries = entriesOf({ "maps/keep.png": "x".repeat(3 * 1024 * 1024) });
    expect(() => refuseUnacceptableEntries(entries, { ...limits, maxImageBytes: 2 * 1024 * 1024 })).toThrow(
      /"maps\/keep\.png" is 3 MB, and one file may be at most 2 MB/
    );
  });

  it("refuses an archive past the total, before anything is expanded", () => {
    const megabyte = "x".repeat(1024 * 1024);
    const entries = entriesOf({ "maps/a.png": megabyte, "maps/b.png": megabyte, "maps/c.png": megabyte });
    expect(() => refuseUnacceptableEntries(entries, { ...limits, maxBytes: 2 * 1024 * 1024 })).toThrow(
      /expands to 3 MB, and at most 2 MB may be imported at once/
    );
  });

  it("refuses an archive with too many files, and an empty one", () => {
    expect(() => refuseUnacceptableEntries(entriesOf({ "maps/a.png": "x" }), { ...limits, maxEntries: 0 })).toThrow(
      /holds 1 files, and at most 0 may be imported/
    );
    expect(() => refuseUnacceptableEntries([], limits)).toThrow(/The campaign is empty/);
  });

  it("lets every folder carry an index.json, whatever else it holds", () => {
    expect(() =>
      refuseUnacceptableEntries(entriesOf({ "audio/index.json": "{}", "audio/dirge.mp3": "x" }), limits)
    ).not.toThrow();
  });
});

describe("reading a campaign", () => {
  it("reads a bundle of nothing but maps, naming them after their files", () => {
    const campaign = readCampaign(stage({ "maps/the-keep.png": "x", "maps/under-halls.png": "y" }));

    expect(campaign.media.map((entry) => [entry.path, entry.displayName, entry.category])).toEqual([
      ["maps/the-keep.png", "the keep", "map"],
      ["maps/under-halls.png", "under halls", "map"]
    ]);
    expect(campaign.warnings).toEqual([]);
  });

  it("reads the manifest, and the overview beside it", () => {
    const campaign = readCampaign(stage({ "manifest.json": manifest(), "campaign.md": "# Tomb\n", "maps/a.png": "x" }));

    expect(campaign.manifest.name).toBe("Tomb of the Serpent Kings");
    expect(campaign.manifest.system).toBe("cairn");
    expect(campaign.manifest.version).toBe("1.2");
    expect(campaign.overview).toBe("# Tomb\n");
    expect(campaign.guessed).toEqual([]);
  });

  /**
   * The case the format exists for. A GM who dragged folders together has a
   * campaign; what was assumed is said out loud rather than presented as read.
   */
  it("reads a bundle with no manifest at all, and says what it assumed", () => {
    const campaign = readCampaign(stage({ "maps/a.png": "x" }), { fallbackName: "Tomb of the Serpent Kings" });

    expect(campaign.manifest.name).toBe("Tomb of the Serpent Kings");
    expect(campaign.manifest.campaignId).toBe("tomb-of-the-serpent-kings");
    expect(campaign.manifest.system).toBe("*");
    expect(campaign.guessed).toHaveLength(2);
    expect(campaign.guessed[0]).toMatch(/carries no manifest\.json/);
  });

  it("refuses a manifest from a newer version of this application", () => {
    expect(() => readCampaign(stage({ "manifest.json": manifest({ bundleVersion: 9 }), "maps/a.png": "x" }))).toThrow(
      /written by a newer version \(9\)/
    );
  });

  it("refuses a manifest that is not one, naming the field", () => {
    expect(() =>
      readCampaign(stage({ "manifest.json": manifest({ system: "Not An Id" }), "maps/a.png": "x" }))
    ).toThrow(/manifest\.json is not valid — system: a system id, or "\*"/);
    expect(() => readCampaign(stage({ "manifest.json": "{ not json", "maps/a.png": "x" }))).toThrow(
      /manifest\.json could not be read as JSON/
    );
  });

  it("takes display names and order from an index, and keeps the rest after it", () => {
    const index = JSON.stringify({
      files: [
        { file: "under-halls.png", name: "The Under Halls" },
        { file: "the-keep.png", name: "The Keep" }
      ]
    });
    const campaign = readCampaign(
      stage({ "maps/index.json": index, "maps/the-keep.png": "x", "maps/under-halls.png": "y", "maps/gate.png": "z" })
    );

    expect(campaign.media.map((entry) => entry.displayName)).toEqual(["The Under Halls", "The Keep", "gate"]);
    expect(campaign.media.map((entry) => entry.sortOrder)).toEqual([0, 1, 2]);
  });

  it("refuses an index naming a file the folder does not hold", () => {
    const index = JSON.stringify({ files: [{ file: "missing.png", name: "Nowhere" }] });
    expect(() => readCampaign(stage({ "maps/index.json": index, "maps/the-keep.png": "x" }))).toThrow(
      /maps\/index\.json names "missing\.png", which the folder does not hold/
    );
  });

  it("carries the tags an audio index states", () => {
    const index = JSON.stringify({ files: [{ file: "dirge.mp3", name: "Dirge", artist: "Nobody", album: "Tomb" }] });
    const campaign = readCampaign(stage({ "audio/index.json": index, "audio/dirge.mp3": "x" }));

    expect(campaign.media[0].tags).toEqual({ artist: "Nobody", title: undefined, album: "Tomb" });
  });

  it("sorts playlists and resolves their tracks against the audio that is there", () => {
    const campaign = readCampaign(
      stage({
        "audio/dirge.mp3": "x",
        "audio/march.mp3": "y",
        "playlists/combat.json": JSON.stringify({ name: "Combat", sortOrder: 1, tracks: ["audio/march.mp3"] }),
        "playlists/rest.json": JSON.stringify({ name: "Rest", sortOrder: 0, tracks: ["audio/dirge.mp3"] })
      })
    );

    expect(campaign.playlists.map((playlist) => playlist.name)).toEqual(["Rest", "Combat"]);
    expect(campaign.playlists[1].tracks).toEqual(["audio/march.mp3"]);
  });

  it("refuses a playlist naming a track the bundle does not carry", () => {
    expect(() =>
      readCampaign(
        stage({
          "audio/dirge.mp3": "x",
          "playlists/combat.json": JSON.stringify({ name: "Combat", tracks: ["audio/missing.mp3"] })
        })
      )
    ).toThrow(/playlists\/combat\.json names "audio\/missing\.mp3", which the bundle does not contain/);
  });

  it("keeps a room's settings, and warns off a theme this server has not got", () => {
    const room = JSON.stringify({ name: "The Tomb", theme: "ember", musicEnabled: true });
    const campaign = readCampaign(stage({ "room.json": room, "maps/a.png": "x" }));

    expect(campaign.room.name).toBe("The Tomb");
    expect(campaign.room.musicEnabled).toBe(true);
    expect(campaign.room.theme).toBeUndefined();
    expect(campaign.warnings[0]).toMatch(/names the theme "ember", which this server does not have/);
  });

  it("refuses a room.json carrying a setting that is not one", () => {
    expect(() => readCampaign(stage({ "room.json": '{"nickname":"Tomb"}', "maps/a.png": "x" }))).toThrow(
      /room\.json is not valid/
    );
  });

  /**
   * Every folder the format declares is now read. This is the check that keeps it
   * that way: a folder added to the allowlist without a reader would land here as
   * a bundle that appears to import and quietly drops part of itself, which is the
   * one failure this format must never have.
   */
  it("reads every folder a campaign may carry", () => {
    const table = JSON.stringify({
      formatVersion: 1,
      tables: [
        {
          name: "Rumours",
          dice: "d6",
          columns: ["Roll", "Rumour"],
          rows: [{ label: "1", min: 1, max: 6, cells: ["A lie"] }]
        }
      ]
    });
    const campaign = readCampaign(
      stage({
        "maps/keep.png": "x",
        "scenes/gate.png": "y",
        "references/letter.md": "# A letter",
        "audio/dirge.mp3": "z",
        "playlists/combat.json": JSON.stringify({ name: "Combat", tracks: ["audio/dirge.mp3"] }),
        "npcs/vane.json": JSON.stringify({ name: "Vane" }),
        "encounters/gate.json": JSON.stringify({ name: "The Gate", combatants: [{ npc: "npcs/vane.json" }] }),
        "items/index.json": JSON.stringify({ added: [{ listKey: "inventory", name: "A Rope" }] }),
        "hirelings/brann.json": JSON.stringify({ name: "Brann" }),
        "assets/kestrel.json": JSON.stringify({ name: "The Kestrel", kind: "starship" }),
        "obligations/debt.json": JSON.stringify({ name: "A debt", owedTo: "The Baron" }),
        "tables/rumours.json": table
      })
    );

    expect(campaign.media).toHaveLength(4);
    expect(campaign.playlists).toHaveLength(1);
    expect(campaign.npcs).toHaveLength(1);
    expect(campaign.encounters).toHaveLength(1);
    expect(campaign.items.added).toHaveLength(1);
    expect(campaign.hirelings).toHaveLength(1);
    expect(campaign.assets).toHaveLength(1);
    expect(campaign.obligations).toHaveLength(1);
    expect(campaign.tables).toEqual([
      { path: "tables/rumours.json", name: "rumours", tags: [], json: expect.stringContaining("Rumours") }
    ]);
  });
});

describe("naming a file nothing named", () => {
  it("drops the extension and opens up the separators", () => {
    expect(displayNameFromFile("the-keep.png")).toBe("the keep");
    expect(displayNameFromFile("under_halls.webp")).toBe("under halls");
    expect(displayNameFromFile("The TOMB.jpg")).toBe("The TOMB");
  });

  it("keeps a name it would otherwise empty", () => {
    expect(displayNameFromFile(".png")).toBe(".png");
  });
});
