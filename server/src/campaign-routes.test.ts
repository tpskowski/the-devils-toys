import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { campaignPreview } from "./campaign-routes.js";
import { stageCampaignArchive, type StagedCampaign } from "./campaign-staging.js";
import { config } from "./config.js";
import { db } from "./db.js";
import { installToybox } from "./test-fixture.js";

installToybox();

let roomId = 0;
const ACCOUNT = 1;

beforeEach(() => {
  db.exec("DELETE FROM room_playlists; DELETE FROM media; DELETE FROM memberships; DELETE FROM rooms;");
  db.exec("DELETE FROM accounts;");
  db.prepare(
    "INSERT INTO accounts (id, username, password_hash, is_admin, account_role) VALUES (?, ?, '', 1, 'admin')"
  ).run(ACCOUNT, "Admin");
  roomId = Number(
    db
      .prepare("INSERT INTO rooms (name, system, theme, created_by) VALUES ('The Tomb', 'toybox', 'grim', ?)")
      .run(ACCOUNT).lastInsertRowid
  );
});

/** Puts a file in the room's library, in the shape the media route writes one. */
function hold(category: "map" | "scene" | "reference" | "audio", filename: string, size = 10) {
  db.prepare(
    `INSERT INTO media (room_id, uploaded_by, kind, category, filename, stored_name, mime_type, size)
     VALUES (?, ?, ?, ?, ?, ?, 'image/png', ?)`
  ).run(roomId, ACCOUNT, category === "map" ? "scene" : category, category, filename, `${filename}-stored`, size);
}

function stage(files: Record<string, string>): StagedCampaign {
  const archive = path.join(config.dataDir, `${Math.random().toString(36).slice(2)}.zip`);
  fs.writeFileSync(
    archive,
    zipSync(Object.fromEntries(Object.entries(files).map(([entry, body]) => [entry, strToU8(body)])), { level: 6 })
  );
  return stageCampaignArchive(archive, { roomId, accountId: ACCOUNT, archiveName: "tomb.devilcampaign.zip" });
}

const preview = (files: Record<string, string>) => {
  const staged = stage(files);
  return campaignPreview(staged.campaign, staged.record.token, roomId);
};

describe("what a preview says would happen", () => {
  it("counts each kind against what the room already holds", () => {
    hold("map", "the-keep.png");
    hold("scene", "the-keep.png");

    const result = preview({
      "maps/the-keep.png": "x",
      "maps/under-halls.png": "y",
      "scenes/gate.png": "z",
      "references/letter.md": "# A letter"
    });

    expect(result.kinds).toEqual([
      // Same filename and same category as one the room holds.
      { kind: "maps", new: 1, conflict: 1 },
      // Same filename as a map the room holds, but a scene: a different thing.
      { kind: "scenes", new: 1, conflict: 0 },
      { kind: "references", new: 1, conflict: 0 }
    ]);
  });

  it("counts a playlist as a conflict by name, whatever its case", () => {
    db.prepare("INSERT INTO room_playlists (room_id, name) VALUES (?, 'Combat')").run(roomId);

    const result = preview({
      "audio/march.mp3": "x",
      "playlists/combat.json": JSON.stringify({ name: "combat", tracks: ["audio/march.mp3"] }),
      "playlists/rest.json": JSON.stringify({ name: "Rest", tracks: [] })
    });

    expect(result.kinds.find((kind) => kind.kind === "playlists")).toEqual({
      kind: "playlists",
      new: 1,
      conflict: 1
    });
  });

  /**
   * The arithmetic a GM needs before they commit, not after. `remaining` is what
   * the instance's whole allowance has left, which is the limit an import is
   * actually held to.
   */
  it("weighs the campaign against the allowance the instance has left", () => {
    hold("map", "already-here.png", 400);
    const result = preview({ "maps/a.png": "x".repeat(1000), "audio/b.mp3": "y".repeat(500) });

    expect(result.bytes.incoming).toBe(1500);
    expect(result.bytes.remaining).toBe(config.uploadLimitMb * 1024 * 1024 - 400);
  });

  it("carries the overview, the guesses, and the warnings through", () => {
    const result = preview({
      "campaign.md": "# Tomb of the Serpent Kings",
      "room.json": JSON.stringify({ theme: "ember" }),
      "maps/a.png": "x",
      "tables/rumours.json": "{}"
    });

    expect(result.overview).toBe("# Tomb of the Serpent Kings");
    expect(result.guessed[0]).toMatch(/carries no manifest\.json/);
    expect(result.warnings).toEqual([
      expect.stringMatching(/theme "ember", which this server does not have/),
      expect.stringMatching(/tables\/ holds 1 file, which this build does not import yet/)
    ]);
    expect(result.pending).toEqual([{ folder: "tables", files: 1 }]);
  });

  it("reports a bundle that names no system as one that needs none", () => {
    const result = preview({ "maps/a.png": "x" });
    expect(result.campaign.system).toBe("*");
    expect(result.systemMatch).toBe("agnostic");
  });

  it("reports a bundle written for this room's system as an exact match", () => {
    const manifest = JSON.stringify({
      app: "devils-toys-campaign",
      bundleVersion: 1,
      campaignId: "tomb",
      name: "Tomb",
      system: "toybox"
    });
    const result = preview({ "manifest.json": manifest, "maps/a.png": "x" });

    expect(result.systemMatch).toBe("exact");
    expect(result.campaign.name).toBe("Tomb");
  });
});
