import fs from "node:fs";
import express from "express";
import cookieParser from "cookie-parser";
import { authMiddleware, requireAuth } from "./auth.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { projectFile } from "./paths.js";
import { sessionRouter } from "./session-routes.js";
import { loadInstalledSystems } from "./system-registry.js";
import { tableEditorRouter } from "./table-editor.js";
import { tableSetRouter } from "./table-sets.js";
import { tagRouter } from "./table-tags.js";

/**
 * The Devil's Tables: a table editor that runs on its own port against the same
 * database as the game server, and starts with or without it. It carries no
 * rooms, no WebSocket, and no media — only the table catalogue and the tag
 * vocabulary. The session cookie is scoped by host rather than by port, so a
 * sign-in here is a sign-in there and the other way round.
 */
// The editor lists one table set per system, so it needs the installed ones as
// much as the game server does.
loadInstalledSystems();

const app = express();
app.disable("x-powered-by");
// Bundles are much larger than a chat message, and an import arrives as one body.
app.use(express.json({ limit: "8mb" }));
app.use(cookieParser());
app.use(authMiddleware);
app.use("/api", sessionRouter);
app.use("/api", tableSetRouter);
app.use("/api", tableEditorRouter);
app.use("/api", tagRouter);

/**
 * The written guide to using the editor, served from the repository so there is
 * one copy of it rather than a page that drifts from the file.
 */
app.get("/api/guide", requireAuth, (_req, res) => {
  res.type("text/markdown").send(fs.readFileSync(projectFile("devils-tables.md"), "utf8"));
});

const clientDist = projectFile("tables-client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("/{*splat}", (_req, res) => res.sendFile(projectFile("tables-client", "dist", "index.html")));
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("Request failed", { error: error instanceof Error ? error.message : String(error) });
  res.status(500).json({ error: "The server could not complete that request." });
});

app.listen(config.tablesPort, () =>
  logger.info("The Devil's Tables is ready", { port: config.tablesPort, dataDir: config.dataDir })
);
