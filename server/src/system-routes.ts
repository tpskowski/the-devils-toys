import fs from "node:fs";
import express from "express";
import multer from "multer";
import { z } from "zod";
import { isSystemId } from "@devils-toys/shared";
import type { AuthedRequest } from "./auth.js";
import { requireAuth } from "./auth.js";
import { config } from "./config.js";
import { isBuiltinSystem } from "./builtin-systems.js";
import { logger } from "./logger.js";
import { asyncRoute } from "./session-routes.js";
import { SYSTEM_BUNDLE_VERSION, readSystemBundle, type SystemBundleContent } from "./system-bundles.js";
import { BreakingSystemChangeRequired, breakingSystemChange } from "./system-breaking.js";
import {
  exportSystemBundle,
  refuseUninstallableBundle,
  refuseUninstallableCreation,
  removeSystemContent,
  verifySystemTables,
  writeSystemBundle
} from "./system-install.js";
import { normalizeSystemRelease, recordedSystemRelease } from "./system-repo.js";
import { fetchCatalog, fetchSystemRepo } from "./system-sources.js";
import { catalogueOffers, systemUpdates } from "./system-updates.js";
import { SCHEMA_FILE } from "./system-schema-json.js";
import { requireSystemAdmin } from "./system-permissions.js";
import {
  deleteSystemRow,
  loadInstalledSystem,
  recordInstalledSystem,
  roomNamesOn,
  setSystemRetired,
  storedSystemRelease,
  storedSystemSource,
  storedSystemVersion,
  systemRow,
  systemRows,
  systemUsage,
  unloadSystem
} from "./system-registry.js";
import { hasSystem, systemOrThrow } from "./systems.js";

/**
 * Installing, retiring, and exporting a game system.
 *
 * Everything that writes is an admin's, because a system is server-wide: it is
 * the difference between configuring a room and deciding what the server can
 * run. Listing is open to anyone signed in, who already learns which systems
 * exist from `/api/status`.
 */
export const systemRouter = express.Router();

/** Held in memory: a bundle is unpacked and checked before anything is written. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.systemUploadLimitMb * 1024 * 1024, files: 1 }
});

const acknowledgementSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .optional();

/** A structured refusal the client can review and retry without reading prose. */
function refuseBreakingChange(res: express.Response, cause: unknown, by: string) {
  if (!(cause instanceof BreakingSystemChangeRequired)) return false;
  logger.info("Breaking system change awaiting acknowledgement", {
    system: cause.change.systemId,
    from: cause.change.fromVersion || "unversioned",
    to: cause.change.toVersion || "unversioned",
    by
  });
  res.status(409).json({ code: "breaking_system_change", error: cause.message, change: cause.change });
  return true;
}

function publicSystem(row: ReturnType<typeof systemRows>[number]) {
  const usage = systemUsage(row.id);
  const loaded = hasSystem(row.id);
  return {
    id: row.id,
    name: row.name,
    origin: row.origin,
    retired: Boolean(row.retired),
    /**
     * False for a system whose row survives but whose definition would not
     * load, which is how a broken bundle presents: its rooms still open on
     * whatever they already hold, and it can be replaced or deleted.
     */
    loaded,
    tagline: loaded ? systemOrThrow(row.id).tagline : "",
    rooms: usage.rooms,
    characters: usage.characters,
    /** The author's own release version, empty for a system that declares none. */
    version: storedSystemVersion(row),
    /** Absent for a system that arrived as an uploaded file. */
    source: storedSystemSource(row),
    installedAt: row.installed_at,
    updatedAt: row.updated_at
  };
}

/**
 * The install itself, which is the same six steps however the system arrived.
 *
 * Order is the whole of it: everything that can fail happens before the registry
 * has heard of the system, and the server only starts offering it on the last
 * line. A refusal leaves the previous content and the previous row exactly as
 * they were.
 */
function installValidated(
  content: SystemBundleContent,
  manifest: unknown,
  installedBy: number,
  acknowledgeBreaking = ""
): ReturnType<typeof writeSystemBundle> & { breakingAcknowledged: boolean } {
  refuseUninstallableBundle(content);
  refuseUninstallableCreation(content);
  verifySystemTables(content.system.id, content.system, content.tables);

  const previous = systemRow(content.system.id);
  const incoming = normalizeSystemRelease(
    manifest && typeof manifest === "object" ? (manifest as Parameters<typeof normalizeSystemRelease>[0]) : {}
  );
  const change = breakingSystemChange(
    content.system.id,
    content.system.name,
    previous ? storedSystemRelease(previous) : undefined,
    incoming
  );
  if (change && acknowledgeBreaking !== change.fingerprint) throw new BreakingSystemChangeRequired(change);

  const result = writeSystemBundle(content);
  recordInstalledSystem({ id: content.system.id, name: content.system.name, manifest, installedBy });
  loadInstalledSystem(content.system.id);
  return { ...result, breakingAcknowledged: Boolean(change) };
}

systemRouter.get("/admin/systems", requireAuth, (req: AuthedRequest, res) => {
  if (!requireSystemAdmin(req, res)) return;
  res.json({ systems: systemRows().map(publicSystem) });
});

systemRouter.post(
  "/admin/systems",
  requireAuth,
  upload.single("bundle"),
  asyncRoute(async (req, res) => {
    if (!requireSystemAdmin(req, res)) return;
    if (!req.file) return res.status(400).json({ error: "Attach a system bundle to install." });
    const acknowledgement = acknowledgementSchema.safeParse(req.body?.acknowledgeBreaking || undefined);
    if (!acknowledgement.success)
      return res.status(400).json({ error: "That breaking-change acknowledgement is invalid." });

    let result;
    try {
      const bundle = readSystemBundle(new Uint8Array(req.file.buffer));
      result = installValidated(bundle, bundle.manifest, req.account!.id, acknowledgement.data);
    } catch (cause) {
      if (refuseBreakingChange(res, cause, req.account!.username)) return;
      const message = cause instanceof Error ? cause.message : "That bundle could not be installed.";
      logger.warn("System install refused", { error: message, by: req.account!.username });
      return res.status(400).json({ error: message });
    }

    logger.info("System installed", {
      system: result.system,
      by: req.account!.username,
      replaced: result.replaced,
      breakingAcknowledged: result.breakingAcknowledged
    });
    res.status(result.replaced ? 200 : 201).json({
      system: publicSystem(systemRow(result.system)!),
      replaced: result.replaced,
      breakingAcknowledged: result.breakingAcknowledged,
      licenses: result.licenses
    });
  })
);

/**
 * What a system may say about itself, as JSON Schema.
 *
 * Open to anyone, and deliberately: it describes the format rather than anything
 * about this server, and a system's author needs it while they are writing one —
 * which is before they have an account here, if they ever have one at all.
 */
systemRouter.get("/systems/schema", (_req, res) => {
  if (!fs.existsSync(SCHEMA_FILE)) return res.status(404).json({ error: "This build published no system schema." });
  res.type("application/schema+json").send(fs.readFileSync(SCHEMA_FILE, "utf8"));
});

/**
 * The menu: what an admin may install without going looking for it.
 *
 * Each entry says whether it is installed, and whether what is on offer is
 * provably later than what was installed. A catalogue this server cannot reach
 * is reported as such rather than as an empty menu — "nothing to install" and "I
 * could not ask" are different answers and an admin needs to tell them apart.
 */
systemRouter.get(
  "/admin/systems/catalog",
  requireAuth,
  asyncRoute(async (req, res) => {
    if (!requireSystemAdmin(req, res)) return;
    if (!config.systemCatalogUrl) return res.json({ configured: false, systems: [] });

    let systems;
    try {
      systems = await fetchCatalog();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The catalogue could not be read.";
      logger.warn("System catalogue unavailable", { error: message });
      return res.status(502).json({ configured: true, error: message, systems: [] });
    }

    // Answered against the same check the installed list runs, so the menu and
    // the list cannot tell an admin two different things about one system.
    res.json({ configured: true, systems: await catalogueOffers(systems) });
  })
);

/**
 * Whether anything an admin has installed has moved on.
 *
 * One answer per installed system, and every one of them is that system's own:
 * a repository that will not answer produces an `unreachable` row carrying the
 * reason, rather than a failed request that would take the other systems'
 * answers down with it. Nothing here installs anything — it says what is on
 * offer, and an admin presses the button.
 */
systemRouter.get(
  "/admin/systems/updates",
  requireAuth,
  asyncRoute(async (req, res) => {
    if (!requireSystemAdmin(req, res)) return;
    res.json({ systems: await systemUpdates() });
  })
);

/**
 * Installs a system from its repository.
 *
 * Either from the catalogue by id, or from any allowed repository by name and
 * ref — the second is what an author uses before their system is listed, and
 * what an operator uses for one that never will be.
 */
/**
 * Fetching a repository and installing what comes back.
 *
 * An import and an update do exactly this and differ only in how the repository
 * was named and in what the log says afterwards — decision 9 of the plan, and
 * the reason there is no second install path to keep in step with this one.
 */
async function installFromRepository(
  repository: string,
  ref: string | undefined,
  catalogVersion: string,
  by: number,
  acknowledgeBreaking = ""
) {
  const fetched = await fetchSystemRepo(repository, ref || "main");
  const release = recordedSystemRelease(fetched.marker, catalogVersion);
  // From here it is the upload path exactly: the same checks, in the same
  // order, on the same shape. Arriving over the network buys no trust.
  const result = installValidated(
    fetched,
    {
      bundleVersion: SYSTEM_BUNDLE_VERSION,
      app: "devils-toys-system",
      systemId: fetched.system.id,
      systemName: fetched.system.name,
      exportedAt: fetched.source.fetchedAt,
      licenses: fetched.marker.licenses,
      ...release,
      source: fetched.source
    },
    by,
    acknowledgeBreaking
  );
  return { result, fetched };
}

systemRouter.post(
  "/admin/systems/import",
  requireAuth,
  asyncRoute(async (req, res) => {
    if (!requireSystemAdmin(req, res)) return;
    const parsed = z
      .object({
        id: z.string().optional(),
        repository: z.string().optional(),
        ref: z.string().optional(),
        acknowledgeBreaking: acknowledgementSchema
      })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Name a catalogue id, or a repository and ref." });

    let repository = parsed.data.repository;
    let ref = parsed.data.ref;
    /**
     * Only a fallback. The system's own marker is what a version is read from
     * below — the catalogue is one reader of an author's release rather than the
     * authority on it, and a repository named by hand has no catalogue entry at
     * all, which is how a direct import used to record no version whatsoever.
     */
    let catalogVersion = "";
    if (parsed.data.id) {
      let entry;
      try {
        entry = (await fetchCatalog()).find((candidate) => candidate.id === parsed.data.id);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "The catalogue could not be read.";
        return res.status(502).json({ error: message });
      }
      if (!entry) return res.status(404).json({ error: `The catalogue has no system called "${parsed.data.id}".` });
      repository = entry.repository;
      ref = entry.ref;
      catalogVersion = entry.version;
    }
    if (!repository) return res.status(400).json({ error: "Name a catalogue id, or a repository and ref." });

    let installed;
    try {
      installed = await installFromRepository(
        repository,
        ref,
        catalogVersion,
        req.account!.id,
        parsed.data.acknowledgeBreaking
      );
    } catch (cause) {
      if (refuseBreakingChange(res, cause, req.account!.username)) return;
      const message = cause instanceof Error ? cause.message : "That system could not be installed.";
      logger.warn("System import refused", { repository, ref, error: message, by: req.account!.username });
      return res.status(400).json({ error: message });
    }
    const { result, fetched } = installed;

    logger.info("System imported", {
      system: result.system,
      repository,
      ref: fetched.source.ref,
      revision: fetched.source.revision,
      by: req.account!.username,
      replaced: result.replaced,
      breakingAcknowledged: result.breakingAcknowledged
    });
    res.status(result.replaced ? 200 : 201).json({
      system: publicSystem(systemRow(result.system)!),
      replaced: result.replaced,
      breakingAcknowledged: result.breakingAcknowledged,
      licenses: result.licenses,
      source: fetched.source
    });
  })
);

/**
 * Updating a system: installing it again from the source it already came from.
 *
 * It is its own route rather than a client re-posting to `/import` so that the
 * record says what actually happened — an update names the version it moved from
 * and the version it moved to, which is the one question asked afterwards when a
 * room starts behaving differently.
 */
systemRouter.post(
  "/admin/systems/:systemId/update",
  requireAuth,
  asyncRoute(async (req, res) => {
    if (!requireSystemAdmin(req, res)) return;
    const system = String(req.params.systemId);
    const row = systemRow(system);
    if (!row) return res.status(404).json({ error: `No such system: ${system}.` });

    const source = storedSystemSource(row);
    if (!source)
      return res
        .status(409)
        .json({ error: `${row.name} was installed from a file, so there is nothing to update it from.` });

    const from = storedSystemVersion(row);
    const acknowledgement = z.object({ acknowledgeBreaking: acknowledgementSchema }).safeParse(req.body ?? {});
    if (!acknowledgement.success)
      return res.status(400).json({ error: "That breaking-change acknowledgement is invalid." });
    let installed;
    try {
      installed = await installFromRepository(
        source.repository,
        source.ref,
        "",
        req.account!.id,
        acknowledgement.data.acknowledgeBreaking
      );
    } catch (cause) {
      if (refuseBreakingChange(res, cause, req.account!.username)) return;
      const message = cause instanceof Error ? cause.message : "That system could not be updated.";
      logger.warn("System update refused", {
        system,
        repository: source.repository,
        ref: source.ref,
        error: message,
        by: req.account!.username
      });
      return res.status(400).json({ error: message });
    }
    const { result, fetched } = installed;

    const updated = systemRow(result.system)!;
    logger.info("System updated", {
      system: result.system,
      from: from || "unversioned",
      to: storedSystemVersion(updated) || "unversioned",
      repository: source.repository,
      ref: fetched.source.ref,
      revision: fetched.source.revision,
      by: req.account!.username,
      breakingAcknowledged: result.breakingAcknowledged
    });
    res.json({
      system: publicSystem(updated),
      replaced: result.replaced,
      breakingAcknowledged: result.breakingAcknowledged,
      from,
      licenses: result.licenses,
      source: fetched.source
    });
  })
);

systemRouter.get("/admin/systems/:systemId/export", requireAuth, (req: AuthedRequest, res) => {
  if (!requireSystemAdmin(req, res)) return;
  const system = String(req.params.systemId);
  if (!hasSystem(system)) return res.status(404).json({ error: `No such system: ${system}.` });

  const parsed = z
    .object({ as: z.string().optional(), name: z.string().trim().min(1).max(80).optional() })
    .safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid export options." });
  if (parsed.data.as !== undefined && !isSystemId(parsed.data.as))
    return res.status(400).json({ error: `"${parsed.data.as}" is not a usable system id.` });
  if (parsed.data.as && isBuiltinSystem(parsed.data.as))
    return res.status(409).json({ error: `"${parsed.data.as}" is a system this application ships.` });

  const filename = `${parsed.data.as ?? system}.devilsystem.zip`;
  res.type("application/zip").attachment(filename);
  res.send(Buffer.from(exportSystemBundle(system, { ...parsed.data, ...storedSystemRelease(systemRow(system)!) })));
});

systemRouter.post("/admin/systems/:systemId/retire", requireAuth, (req: AuthedRequest, res) => {
  if (!requireSystemAdmin(req, res)) return;
  const system = String(req.params.systemId);
  if (!systemRow(system)) return res.status(404).json({ error: `No such system: ${system}.` });
  setSystemRetired(system, true);
  logger.info("System retired", { system, by: req.account!.username });
  res.json({ system: publicSystem(systemRow(system)!) });
});

systemRouter.post("/admin/systems/:systemId/restore", requireAuth, (req: AuthedRequest, res) => {
  if (!requireSystemAdmin(req, res)) return;
  const system = String(req.params.systemId);
  if (!systemRow(system)) return res.status(404).json({ error: `No such system: ${system}.` });
  setSystemRetired(system, false);
  res.json({ system: publicSystem(systemRow(system)!) });
});

systemRouter.delete("/admin/systems/:systemId", requireAuth, (req: AuthedRequest, res) => {
  if (!requireSystemAdmin(req, res)) return;
  const system = String(req.params.systemId);
  const row = systemRow(system);
  if (!row) return res.status(404).json({ error: `No such system: ${system}.` });
  if (row.origin === "builtin")
    return res.status(409).json({ error: `${row.name} ships with this application and cannot be removed.` });

  // Retirement is what a system in use gets. Deleting one would leave its rooms
  // pointing at nothing, which the foreign key would refuse anyway — this is the
  // same refusal, said in words that name what is in the way.
  const usage = systemUsage(system);
  if (usage.rooms || usage.characters) {
    const names = roomNamesOn(system);
    const rooms = names.length ? ` (${names.join(", ")}${usage.rooms > names.length ? ", …" : ""})` : "";
    return res.status(409).json({
      error:
        `${row.name} is still in use by ${usage.rooms} room${usage.rooms === 1 ? "" : "s"}${rooms}` +
        ` and ${usage.characters} character${usage.characters === 1 ? "" : "s"}. Retire it instead.`
    });
  }

  unloadSystem(system);
  removeSystemContent(system);
  deleteSystemRow(system);
  logger.info("System deleted", { system, by: req.account!.username });
  res.status(204).end();
});

/** Turns multer's own refusals into the same shape every other error takes. */
systemRouter.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error instanceof multer.MulterError) {
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? `A system bundle may be at most ${config.systemUploadLimitMb} MB.`
        : "That upload could not be read.";
    return res.status(413).json({ error: message });
  }
  next(error);
});
