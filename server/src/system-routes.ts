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
import { readSystemBundle } from "./system-bundles.js";
import {
  exportSystemBundle,
  refuseUninstallableBundle,
  removeSystemContent,
  verifySystemTables,
  writeSystemBundle
} from "./system-install.js";
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
    installedAt: row.installed_at,
    updatedAt: row.updated_at
  };
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
      refuseUninstallableBundle(bundle);
      verifySystemTables(bundle.system.id, bundle.system, bundle.tables);
      result = writeSystemBundle(bundle);
      recordInstalledSystem({
        id: bundle.system.id,
        name: bundle.system.name,
        manifest: bundle.manifest,
        installedBy: req.account!.id
      });
      // Only now does the server start offering it. Everything above this line
      // can fail without the registry having heard of the system at all.
      loadInstalledSystem(bundle.system.id);
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
