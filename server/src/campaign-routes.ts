import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import { z } from "zod";
import type { AuthedRequest } from "./auth.js";
import { requireAuth } from "./auth.js";
import { config } from "./config.js";
import { all } from "./db.js";
import { logger } from "./logger.js";
import { ANY_SYSTEM, type Campaign } from "./campaign-bundles.js";
import { applyCampaign } from "./campaign-apply.js";
import { discardStage, stageCampaignArchive, stagedCampaign } from "./campaign-staging.js";
import { broadcastRoom } from "./realtime.js";
import { configurableRoom, requireRoomConfig } from "./room-config-permissions.js";
import { storedUploadBytes } from "./upload-usage.js";

/**
 * Importing a campaign into a room: the upload, what it would do, and doing it.
 *
 * Preview then commit, and the split is the point. An upload is expanded into a
 * stage and read, and what comes back describes what confirming it would land; a
 * second request confirms it. Nothing is written to the room until that second
 * request, and a GM who does not like what the first one said can walk away
 * having changed nothing.
 *
 * Everything is behind `requireRoomConfig`, so it is the room's GM and any
 * admin: a campaign is room content, not a server-wide install. An uploaded zip
 * is the only way in. No path on this server may be named and nothing is
 * fetched, which is one route to defend rather than two.
 */
export const campaignRouter = express.Router();

/**
 * Straight to disk. A campaign is the one upload this application takes that can
 * be measured in gigabytes, and `multer.memoryStorage` — which the system
 * importer uses quite correctly for its hundred kilobytes — would hold the whole
 * archive and then be asked to hold its contents as well.
 */
const uploadsDirectory = () => path.join(config.dataDir, "imports", "uploads");
const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, callback) {
      const directory = uploadsDirectory();
      fs.mkdirSync(directory, { recursive: true });
      callback(null, directory);
    },
    filename(_req, _file, callback) {
      callback(null, `${crypto.randomUUID()}.zip`);
    }
  }),
  limits: { fileSize: config.campaignUploadLimitMb * 1024 * 1024, files: 1 }
});

function removeUpload(file?: Express.Multer.File) {
  if (!file || path.basename(file.filename) !== file.filename) return;
  try {
    fs.rmSync(file.path, { force: true });
  } catch {
    // The request's outcome does not depend on a temporary file being removable.
  }
}

/** How an incoming kind relates to what the room already holds. */
interface KindCount {
  kind: string;
  new: number;
  conflict: number;
}

export interface CampaignPreview {
  token: string;
  campaign: { campaignId: string; name: string; version: string; system: string };
  /** `exact` when the room runs what the campaign names; `agnostic` when it names none. */
  systemMatch: "exact" | "agnostic";
  overview: string;
  bytes: { incoming: number; remaining: number };
  kinds: KindCount[];
  /** Whether the bundle carries a calendar, which is taken only if asked for. */
  calendar: boolean;
  /** What was assumed about the bundle rather than read from it. */
  guessed: string[];
  warnings: string[];
}

/**
 * What the room already holds that the incoming campaign would land beside.
 *
 * Media is compared by filename within a category, which is what a GM sees and
 * what a re-import of the same bundle would collide with. There is deliberately
 * no "identical" count: telling an unchanged file from a changed one needs the
 * digest the ledger will record, and a column of zeroes labelled "identical"
 * would be a worse answer than not offering one.
 */
function countKinds(campaign: Campaign, roomId: number): KindCount[] {
  const media = all<{ kind: string; filename: string }>(
    "SELECT COALESCE(category, kind) AS kind, filename FROM media WHERE room_id = ?",
    roomId
  );
  const held = new Set(media.map((row) => `${row.kind}/${row.filename}`));
  const playlists = new Set(
    all<{ name: string }>("SELECT name FROM room_playlists WHERE room_id = ?", roomId).map((row) =>
      row.name.toLocaleLowerCase()
    )
  );

  const counts = new Map<string, KindCount>();
  const count = (kind: string, conflicts: boolean) => {
    const entry = counts.get(kind) ?? { kind, new: 0, conflict: 0 };
    if (conflicts) entry.conflict += 1;
    else entry.new += 1;
    counts.set(kind, entry);
  };

  const npcs = new Set(
    all<{ name: string }>("SELECT name FROM custom_npcs WHERE room_id = ?", roomId).map((row) =>
      row.name.toLocaleLowerCase()
    )
  );

  for (const entry of campaign.media) count(entry.folder, held.has(`${entry.category}/${entry.filename}`));
  for (const playlist of campaign.playlists) count("playlists", playlists.has(playlist.name.toLocaleLowerCase()));
  for (const npc of campaign.npcs) count("npcs", npcs.has(npc.name.toLocaleLowerCase()));

  const fights = new Set(
    all<{ name: string }>("SELECT name FROM encounters WHERE room_id = ?", roomId).map((row) =>
      row.name.toLocaleLowerCase()
    )
  );
  for (const encounter of campaign.encounters) count("encounters", fights.has(encounter.name.toLocaleLowerCase()));

  // Gear, hirelings, shared property, and debts are added rather than matched:
  // nothing about them carries an identity a re-import could recognise, which is
  // what the ledger is for. Until then they are honestly reported as additions.
  const add = (kind: string, many: number) => {
    if (many) counts.set(kind, { kind, new: many, conflict: 0 });
  };
  add("tables", campaign.tables.length);
  add("items", campaign.items.added.length + campaign.items.retired.length);
  add("hirelings", campaign.hirelings.length);
  add("assets", campaign.assets.length);
  add("obligations", campaign.obligations.length);
  return [...counts.values()];
}

/** The preview payload, built where a test can reach it without an HTTP round trip. */
export function campaignPreview(campaign: Campaign, token: string, roomId: number): CampaignPreview {
  return {
    token,
    campaign: {
      campaignId: campaign.manifest.campaignId,
      name: campaign.manifest.name,
      version: campaign.manifest.version,
      system: campaign.manifest.system
    },
    systemMatch: campaign.manifest.system === ANY_SYSTEM ? "agnostic" : "exact",
    overview: campaign.overview,
    bytes: {
      incoming: campaign.media.reduce((total, entry) => total + entry.bytes, 0),
      remaining: Math.max(0, config.uploadLimitMb * 1024 * 1024 - storedUploadBytes())
    },
    kinds: countKinds(campaign, roomId),
    calendar: Boolean(campaign.calendar),
    guessed: campaign.guessed,
    warnings: campaign.warnings
  };
}

campaignRouter.post(
  "/rooms/:roomId/campaign/stage",
  requireAuth,
  upload.single("campaign"),
  (req: AuthedRequest, res: express.Response) => {
    const roomId = requireRoomConfig(req, res);
    if (!roomId) return removeUpload(req.file);
    if (!req.file) return res.status(400).json({ error: "Attach a campaign bundle to import." });

    const room = configurableRoom(req.account!, roomId)!;
    let staged;
    try {
      staged = stageCampaignArchive(req.file.path, {
        roomId,
        accountId: req.account!.id,
        archiveName: req.file.originalname
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "That campaign could not be read.";
      logger.warn("Campaign staging refused", { room: roomId, error: message, by: req.account!.username });
      return res.status(400).json({ error: message });
    } finally {
      // The archive has been expanded or refused; either way this copy is spent.
      removeUpload(req.file);
    }

    /**
     * The system check, which is a refusal rather than a warning. A campaign's
     * item lists, statblock fields, and hireling sheets are all shaped by the
     * system it was written for, so importing one into a room running another
     * produces content that is wrong in ways no later check would catch.
     */
    const wanted = staged.campaign.manifest.system;
    if (wanted !== ANY_SYSTEM && wanted !== room.system) {
      discardStage(staged.record.token);
      return res.status(409).json({
        error: `${staged.campaign.manifest.name} is written for "${wanted}", and this room runs "${room.system}".`
      });
    }

    logger.info("Campaign staged", {
      room: roomId,
      campaign: staged.campaign.manifest.campaignId,
      bytes: staged.record.bytes,
      by: req.account!.username
    });
    res.status(201).json(campaignPreview(staged.campaign, staged.record.token, roomId));
  }
);

campaignRouter.get("/rooms/:roomId/campaign/:token", requireAuth, (req: AuthedRequest, res: express.Response) => {
  const roomId = requireRoomConfig(req, res);
  if (!roomId) return;

  let staged;
  try {
    staged = stagedCampaign(String(req.params.token), roomId);
  } catch (cause) {
    return res.status(400).json({ error: cause instanceof Error ? cause.message : "That campaign could not be read." });
  }
  if (!staged) return res.status(404).json({ error: "That upload has expired. Upload the campaign again." });
  res.json(campaignPreview(staged.campaign, staged.record.token, roomId));
});

campaignRouter.post(
  "/rooms/:roomId/campaign/:token/apply",
  requireAuth,
  (req: AuthedRequest, res: express.Response) => {
    const roomId = requireRoomConfig(req, res);
    if (!roomId) return;

    const parsed = z
      .object({
        policy: z.enum(["skip", "replace", "add"]).default("skip"),
        takeRoomSettings: z.boolean().default(false)
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Choose what to do about anything already there." });

    const staged = stagedCampaign(String(req.params.token), roomId);
    if (!staged) return res.status(404).json({ error: "That upload has expired. Upload the campaign again." });

    let result;
    try {
      result = applyCampaign(staged.directory, staged.campaign, roomId, req.account!.id, parsed.data);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "That campaign could not be imported.";
      logger.warn("Campaign import refused", { room: roomId, error: message, by: req.account!.username });
      // The stage is left exactly as it was: a refusal here is something a GM can
      // answer — clear some space, choose another policy — and then try again
      // without uploading a gigabyte a second time.
      return res.status(400).json({ error: message });
    }

    discardStage(staged.record.token);
    broadcastRoom(roomId, { type: "media-updated" });
    if (result.playlists.added || result.playlists.replaced) broadcastRoom(roomId, { type: "audio-updated" });
    if (result.room.length) broadcastRoom(roomId, { type: "room-updated" });

    logger.info("Campaign imported", {
      room: roomId,
      campaign: staged.campaign.manifest.campaignId,
      media: result.media,
      by: req.account!.username
    });
    res.json({ campaign: staged.campaign.manifest.name, ...result });
  }
);

campaignRouter.delete("/rooms/:roomId/campaign/:token", requireAuth, (req: AuthedRequest, res: express.Response) => {
  const roomId = requireRoomConfig(req, res);
  if (!roomId) return;
  // Confirming the stage belongs to this room before removing it, so a token
  // from another room cannot be discarded by guessing at it.
  if (!stagedCampaign(String(req.params.token), roomId))
    return res.status(404).json({ error: "That upload has expired." });
  discardStage(String(req.params.token));
  res.status(204).end();
});

/** Turns multer's own refusals into the shape every other error here takes. */
campaignRouter.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error instanceof multer.MulterError) {
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? `A campaign may be at most ${config.campaignUploadLimitMb} MB. Split it into parts that share a campaignId ` +
          `— the maps in one, everything else in another — and import them one after another.`
        : "That upload could not be read.";
    return res.status(413).json({ error: message });
  }
  next(error);
});
