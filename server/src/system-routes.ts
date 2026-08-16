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
import { readSystemBundle, type SystemBundleContent } from "./system-bundles.js";
import {
  exportSystemBundle,
  refuseUninstallableBundle,
  removeSystemContent,
  verifySystemTables,
  writeSystemBundle
} from "./system-install.js";
import { fetchCatalog, fetchSystemRepo } from "./system-sources.js";
import { SCHEMA_FILE } from "./system-schema-json.js";
import { requireSystemAdmin } from "./system-permissions.js";
import {
  deleteSystemRow,
  loadInstalledSystem,
  recordInstalledSystem,
  roomNamesOn,
  setSystemRetired,
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

/** Where an installed system came from, when it came from a repository. */
function storedSource(row: ReturnType<typeof systemRows>[number]) {
  try {
    const manifest = JSON.parse(row.manifest_json) as { source?: Record<string, unknown>; version?: unknown };
    const source = manifest.source;
    if (!source || typeof source.repository !== "string") return undefined;
    return {
      repository: source.repository,
      ref: typeof source.ref === "string" ? source.ref : "",
      revision: typeof source.revision === "string" ? source.revision : "",
      version: typeof manifest.version === "string" ? manifest.version : "",
      fetchedAt: typeof source.fetchedAt === "string" ? source.fetchedAt : ""
    };
  } catch {
    return undefined;
  }
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
    /** Absent for a system that arrived as an uploaded file. */
    source: storedSource(row),
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
  installedBy: number
): ReturnType<typeof writeSystemBundle> {
  refuseUninstallableBundle(content);
  verifySystemTables(content.system.id, content.system, content.tables);
  const result = writeSystemBundle(content);
  recordInstalledSystem({ id: content.system.id, name: content.system.name, manifest, installedBy });
  loadInstalledSystem(content.system.id);
  return result;
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

    let result;
    try {
      const bundle = readSystemBundle(new Uint8Array(req.file.buffer));
      result = installValidated(bundle, bundle.manifest, req.account!.id);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "That bundle could not be installed.";
      logger.warn("System install refused", { error: message, by: req.account!.username });
      return res.status(400).json({ error: message });
    }

    logger.info("System installed", { system: result.system, by: req.account!.username, replaced: result.replaced });
    res.status(result.replaced ? 200 : 201).json({
      system: publicSystem(systemRow(result.system)!),
      replaced: result.replaced,
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
 * Each entry says whether it is installed, and whether the catalogue offers a
 * version other than the one that was. A catalogue this server cannot reach is
 * reported as such rather than as an empty menu — "nothing to install" and "I
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

    const installed = new Map(systemRows().map((row) => [row.id, row]));
    res.json({
      configured: true,
      systems: systems.map((entry) => {
        const row = installed.get(entry.id);
        const source = row && storedSource(row);
        return {
          ...entry,
          installed: Boolean(row),
          installedVersion: source?.version ?? "",
          // Only ever true when both sides say what they are. Without a version
          // on one of them the honest answer is "reinstall if you like".
          updateAvailable: Boolean(row && entry.version && source?.version && entry.version !== source.version)
        };
      })
    });
  })
);

/**
 * Installs a system from its repository.
 *
 * Either from the catalogue by id, or from any allowed repository by name and
 * ref — the second is what an author uses before their system is listed, and
 * what an operator uses for one that never will be.
 */
systemRouter.post(
  "/admin/systems/import",
  requireAuth,
  asyncRoute(async (req, res) => {
    if (!requireSystemAdmin(req, res)) return;
    const parsed = z
      .object({
        id: z.string().optional(),
        repository: z.string().optional(),
        ref: z.string().optional()
      })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Name a catalogue id, or a repository and ref." });

    let repository = parsed.data.repository;
    let ref = parsed.data.ref;
    let version = "";
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
      version = entry.version;
    }
    if (!repository) return res.status(400).json({ error: "Name a catalogue id, or a repository and ref." });

    let result;
    let fetched;
    try {
      fetched = await fetchSystemRepo(repository, ref || "main");
      // From here it is the upload path exactly: the same checks, in the same
      // order, on the same shape. Arriving over the network buys no trust.
      result = installValidated(
        fetched,
        {
          bundleVersion: 1,
          app: "devils-toys-system",
          systemId: fetched.system.id,
          systemName: fetched.system.name,
          exportedAt: fetched.source.fetchedAt,
          licenses: fetched.marker.licenses,
          version,
          source: fetched.source
        },
        req.account!.id
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "That system could not be installed.";
      logger.warn("System import refused", { repository, ref, error: message, by: req.account!.username });
      return res.status(400).json({ error: message });
    }

    logger.info("System imported", {
      system: result.system,
      repository,
      ref: fetched.source.ref,
      revision: fetched.source.revision,
      by: req.account!.username,
      replaced: result.replaced
    });
    res.status(result.replaced ? 200 : 201).json({
      system: publicSystem(systemRow(result.system)!),
      replaced: result.replaced,
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
  res.send(Buffer.from(exportSystemBundle(system, parsed.data)));
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
