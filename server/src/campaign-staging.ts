import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { readCampaign, refuseUnacceptableEntries, type Campaign } from "./campaign-bundles.js";
import { extractZipEntries, readZipDirectory } from "./zip-safety.js";

/**
 * Where an uploaded campaign waits between arriving and being confirmed.
 *
 * An import is preview then commit, which means a bundle has to exist somewhere
 * across two requests. It cannot be held in memory — the whole point of reading
 * a campaign by its directory is that a gigabyte of maps never lands in the heap
 * — so it is expanded into a directory under the data directory and given a
 * token, and the second request names the token.
 *
 * Nothing here writes to the database or to `uploads/`. A stage is a scratch
 * copy: reaped on a timer, discarded on refusal, and removed the moment its
 * import lands. The one durable promise is the opposite of the usual one — a
 * stage that is forgotten about must not become a permanent tenant of somebody's
 * disk.
 */

/** A token is a UUID and nothing else, because it is about to be joined to a path. */
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface StageRecord {
  token: string;
  roomId: number;
  accountId: number;
  /** The name of the file as uploaded, which names the campaign when no manifest does. */
  archiveName: string;
  /** What the bundle weighed expanded, which is what it will cost the allowance. */
  bytes: number;
  createdAt: string;
}

const importsRoot = () => path.join(config.dataDir, "imports");
const stageRoot = (token: string) => path.join(importsRoot(), token);
const recordFile = (token: string) => path.join(stageRoot(token), "stage.json");
/** The bundle's own files, kept under a subdirectory so the record cannot collide with one. */
export const stagedFiles = (token: string) => path.join(stageRoot(token), "files");

function readRecord(token: string): StageRecord | undefined {
  try {
    const record = JSON.parse(fs.readFileSync(recordFile(token), "utf8")) as StageRecord;
    return record && typeof record.roomId === "number" ? record : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Removes stages older than the time-to-live.
 *
 * Runs on each new stage rather than on a timer: a server that is not importing
 * anything has nothing to clean up, and one that is has just been given the only
 * cue that matters. A directory with no readable record is reaped on age alone,
 * since it is either a stage from a crash or something that has no business here.
 */
export function reapStages(now = Date.now()) {
  const root = importsRoot();
  if (!fs.existsSync(root)) return 0;
  const cutoff = now - config.campaignStageTtlHours * 60 * 60 * 1000;

  let reaped = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(root, entry.name);
    const record = TOKEN.test(entry.name) ? readRecord(entry.name) : undefined;
    let at: number;
    try {
      at = record ? Date.parse(record.createdAt) : fs.statSync(directory).mtimeMs;
    } catch {
      // Gone between the listing and the question — another import's reaper, or
      // an apply that finished. Nothing to clean up, and nothing to report.
      continue;
    }
    if (Number.isFinite(at) && at > cutoff) continue;
    fs.rmSync(directory, { recursive: true, force: true });
    reaped += 1;
  }
  return reaped;
}

export interface StagedCampaign {
  record: StageRecord;
  campaign: Campaign;
  directory: string;
}

export interface StageDetails {
  roomId: number;
  accountId: number;
  archiveName: string;
}

/**
 * The limits an archive is held to, in one place because two callers need them:
 * a GM importing into a room they have, and one making a room out of a bundle.
 */
function archiveLimits() {
  return {
    maxBytes: config.campaignUploadLimitMb * 1024 * 1024,
    maxImageBytes: config.sceneImageUploadLimitMb * 1024 * 1024,
    maxAudioBytes: config.audioUploadLimitMb * 1024 * 1024,
    maxEntries: config.campaignEntryLimit
  };
}

export interface ExpandedCampaign {
  directory: string;
  campaign: Campaign;
  bytes: number;
  /** Removes everything this expansion wrote. The caller owns it. */
  discard: () => void;
}

/**
 * Expands and reads an archive that is not destined for any room yet.
 *
 * Making a room from a bundle has to know what the bundle says — which system it
 * needs, what it would call the room — before there is a room to stage against.
 * So this does the reading half without the record-keeping half, and hands back
 * the means to throw it away.
 */
export function expandCampaignArchive(archive: string, archiveName: string): ExpandedCampaign {
  reapStages();
  const limits = archiveLimits();
  const { entries } = readZipDirectory(archive, "campaign");
  refuseUnacceptableEntries(entries, limits);

  const token = crypto.randomUUID();
  const directory = stagedFiles(token);
  fs.mkdirSync(directory, { recursive: true });
  try {
    const bytes = extractZipEntries(archive, entries, directory, { maxBytes: limits.maxBytes, source: "campaign" });
    const campaign = readCampaign(directory, { fallbackName: campaignNameFromFile(archiveName) });
    return { directory, campaign, bytes, discard: () => fs.rmSync(stageRoot(token), { recursive: true, force: true }) };
  } catch (cause) {
    fs.rmSync(stageRoot(token), { recursive: true, force: true });
    throw cause;
  }
}

/**
 * Expands an uploaded archive into a stage, and reads what it holds.
 *
 * The order is the whole of it, and it is the order `installValidated` uses for
 * a system: everything that can refuse the bundle happens before anything is
 * kept. The archive's directory is read and judged first, so a bundle with a
 * folder nobody recognises costs one read of the tail rather than a full
 * expansion; the stage is only registered once the campaign has been read back
 * out of it and understood.
 *
 * A refusal at any point leaves nothing behind but the caller's archive, which
 * is theirs to remove.
 */
export function stageCampaignArchive(archive: string, details: StageDetails): StagedCampaign {
  reapStages();

  const limits = archiveLimits();
  const { entries } = readZipDirectory(archive, "campaign");
  refuseUnacceptableEntries(entries, limits);

  const token = crypto.randomUUID();
  const directory = stagedFiles(token);
  fs.mkdirSync(directory, { recursive: true });
  try {
    const bytes = extractZipEntries(archive, entries, directory, { maxBytes: limits.maxBytes, source: "campaign" });
    const campaign = readCampaign(directory, { fallbackName: campaignNameFromFile(details.archiveName) });
    const record: StageRecord = { token, ...details, bytes, createdAt: new Date().toISOString() };
    fs.writeFileSync(recordFile(token), `${JSON.stringify(record, null, 2)}\n`);
    return { record, campaign, directory };
  } catch (cause) {
    fs.rmSync(stageRoot(token), { recursive: true, force: true });
    throw cause;
  }
}

/**
 * A stage, re-read rather than remembered.
 *
 * The campaign is parsed again on every look, which costs a few JSON files and
 * buys two things worth more: a restart between the preview and the confirm does
 * not lose the import, and there is no cached copy that can disagree with what is
 * on disk.
 *
 * Scoped to the room rather than to the account. A stage belongs to the room it
 * is destined for — whoever may configure that room may finish an import into it,
 * which is the same rule the rest of Room Config runs on.
 */
export function stagedCampaign(token: string, roomId: number): StagedCampaign | undefined {
  if (!TOKEN.test(token)) return undefined;
  const record = readRecord(token);
  if (!record || record.roomId !== roomId) return undefined;

  const directory = stagedFiles(token);
  if (!fs.existsSync(directory)) return undefined;
  return {
    record,
    campaign: readCampaign(directory, { fallbackName: campaignNameFromFile(record.archiveName) }),
    directory
  };
}

/**
 * The stage's own record, without reading the campaign inside it.
 *
 * For the one question that does not need the campaign: whose stage is this? A
 * bundle too broken to read is still the room's to throw away, and refusing to
 * delete it because it cannot be parsed would leave it there until the reaper.
 */
export function stagedRecordFor(token: string, roomId: number): StageRecord | undefined {
  if (!TOKEN.test(token)) return undefined;
  const record = readRecord(token);
  return record && record.roomId === roomId ? record : undefined;
}

export function discardStage(token: string) {
  if (!TOKEN.test(token)) return false;
  const root = stageRoot(token);
  if (!fs.existsSync(root)) return false;
  fs.rmSync(root, { recursive: true, force: true });
  return true;
}

/**
 * The name a bundle carrying no manifest goes by: its filename, less the suffixes
 * this application put there. `Tomb of the Serpent Kings.devilcampaign.zip`
 * becomes exactly what it says, rather than the whole string with `.zip` on it.
 */
export function campaignNameFromFile(file: string) {
  return (
    path
      .basename(file)
      .replace(/\.zip$/i, "")
      .replace(/\.devilcampaign$/i, "")
      .trim() || "Untitled campaign"
  );
}
