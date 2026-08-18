import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { config } from "./config.js";
import {
  campaignNameFromFile,
  discardStage,
  reapStages,
  stageCampaignArchive,
  stagedCampaign
} from "./campaign-staging.js";
import { installToybox } from "./test-fixture.js";

installToybox();

const ROOM = 7;
const ACCOUNT = 3;

/** Writes an archive into the throwaway data directory, as an upload would land. */
function archiveOf(files: Record<string, string>, name = "tomb.devilcampaign.zip") {
  const file = path.join(config.dataDir, `${Math.random().toString(36).slice(2)}.zip`);
  fs.writeFileSync(
    file,
    zipSync(Object.fromEntries(Object.entries(files).map(([entry, body]) => [entry, strToU8(body)])), { level: 6 })
  );
  return { file, name };
}

const stage = (files: Record<string, string>, room = ROOM, name = "tomb.devilcampaign.zip") => {
  const archive = archiveOf(files, name);
  return stageCampaignArchive(archive.file, { roomId: room, accountId: ACCOUNT, archiveName: archive.name });
};

describe("staging a campaign", () => {
  it("expands a bundle and reads it back by its token", () => {
    const staged = stage({ "maps/the-keep.png": "an image", "campaign.md": "# Tomb" });

    expect(staged.record.roomId).toBe(ROOM);
    expect(staged.record.bytes).toBe("an image".length + "# Tomb".length);
    expect(staged.campaign.media.map((entry) => entry.path)).toEqual(["maps/the-keep.png"]);

    const reread = stagedCampaign(staged.record.token, ROOM);
    expect(reread?.campaign.overview).toBe("# Tomb");
    expect(reread?.campaign.media[0].displayName).toBe("the keep");
  });

  /**
   * A stage belongs to the room it is destined for. Reading one from another room
   * would let a GM aim someone else's upload at their own room, which is both a
   * leak and a way to write bytes nobody agreed to.
   */
  it("does not hand a stage to another room", () => {
    const staged = stage({ "maps/a.png": "x" });
    expect(stagedCampaign(staged.record.token, ROOM + 1)).toBeUndefined();
    expect(stagedCampaign(staged.record.token, ROOM)).toBeDefined();
  });

  it("refuses a token that is not one, rather than joining it to a path", () => {
    for (const token of ["../../etc", "..", "", "not-a-uuid", "/absolute"])
      expect(stagedCampaign(token, ROOM)).toBeUndefined();
    expect(discardStage("../../etc")).toBe(false);
  });

  it("names a campaign after its file when the bundle carries no manifest", () => {
    const staged = stage({ "maps/a.png": "x" }, ROOM, "Tomb of the Serpent Kings.devilcampaign.zip");
    expect(staged.campaign.manifest.name).toBe("Tomb of the Serpent Kings");
    expect(staged.campaign.guessed).toHaveLength(2);
  });

  it("leaves nothing behind when a bundle is refused", () => {
    const before = fs.readdirSync(path.join(config.dataDir, "imports"));
    expect(() => stage({ "map/typo.png": "x" })).toThrow(/not one a campaign may carry/);
    expect(fs.readdirSync(path.join(config.dataDir, "imports"))).toEqual(before);
  });

  it("discards a stage, and says so only when there was one", () => {
    const staged = stage({ "maps/a.png": "x" });
    expect(discardStage(staged.record.token)).toBe(true);
    expect(discardStage(staged.record.token)).toBe(false);
    expect(stagedCampaign(staged.record.token, ROOM)).toBeUndefined();
  });
});

describe("reaping abandoned stages", () => {
  it("keeps a fresh stage and removes one past its time", () => {
    const fresh = stage({ "maps/a.png": "x" });
    const stale = stage({ "maps/b.png": "y" });

    // Age only the second one, by rewriting the record the reaper reads.
    const record = path.join(config.dataDir, "imports", stale.record.token, "stage.json");
    const aged = { ...JSON.parse(fs.readFileSync(record, "utf8")), createdAt: new Date(0).toISOString() };
    fs.writeFileSync(record, JSON.stringify(aged));

    expect(reapStages()).toBe(1);
    expect(stagedCampaign(stale.record.token, ROOM)).toBeUndefined();
    expect(stagedCampaign(fresh.record.token, ROOM)).toBeDefined();
  });

  /**
   * A directory with no readable record is what a crash between `mkdir` and the
   * record write leaves. It has no expiry of its own, so it is reaped on age
   * alone rather than left to sit there for ever.
   */
  it("reaps a directory that carries no record at all", () => {
    const orphan = path.join(config.dataDir, "imports", "9f1d2c3b-4a5e-6f70-8192-a3b4c5d6e7f8");
    fs.mkdirSync(path.join(orphan, "files"), { recursive: true });

    expect(reapStages(Date.now() + config.campaignStageTtlHours * 60 * 60 * 1000 + 1000)).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(orphan)).toBe(false);
  });

  it("runs on each new stage, so an import is the only cue it needs", () => {
    const stale = stage({ "maps/a.png": "x" });
    const record = path.join(config.dataDir, "imports", stale.record.token, "stage.json");
    fs.writeFileSync(
      record,
      JSON.stringify({ ...JSON.parse(fs.readFileSync(record, "utf8")), createdAt: new Date(0).toISOString() })
    );

    stage({ "maps/b.png": "y" });
    expect(stagedCampaign(stale.record.token, ROOM)).toBeUndefined();
  });
});

describe("the name a bundle goes by when nothing names it", () => {
  it("drops the suffixes this application put there", () => {
    expect(campaignNameFromFile("Tomb of the Serpent Kings.devilcampaign.zip")).toBe("Tomb of the Serpent Kings");
    expect(campaignNameFromFile("tomb.ZIP")).toBe("tomb");
    expect(campaignNameFromFile("/tmp/uploads/tomb.zip")).toBe("tomb");
    expect(campaignNameFromFile(".zip")).toBe("Untitled campaign");
  });
});
