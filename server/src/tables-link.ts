import express from "express";
import type { AuthedRequest } from "./auth.js";
import { requireAuth } from "./auth.js";
import { config } from "./config.js";
import { requireTableEdit } from "./table-permissions.js";

/**
 * What the game needs to know to point at The Devil's Tables: where it is, and
 * whether anyone is home. The editor is a separate process that may simply not
 * be running, and a link that fails in the browser tells nobody why.
 *
 * This lives only on the game server; the editor has no reason to serve it.
 */
export const tablesLinkRouter = express.Router();

/**
 * Probing costs a request, and the rail asks on every load. A couple of seconds
 * of memory is enough to make a page refresh free without making the answer
 * stale enough to mislead.
 */
const cacheMs = 2000;
let cached: { at: number; running: boolean } | undefined;

async function editorIsRunning() {
  if (cached && Date.now() - cached.at < cacheMs) return cached.running;
  let running = false;
  try {
    // Loopback rather than the browser's address: this asks whether the process
    // exists, which is the thing that can be started from a terminal.
    const response = await fetch(`http://127.0.0.1:${config.tablesPort}/api/status`, {
      signal: AbortSignal.timeout(500)
    });
    running = response.ok;
  } catch {
    running = false;
  }
  cached = { at: Date.now(), running };
  return running;
}

tablesLinkRouter.get("/tables-app", requireAuth, (req: AuthedRequest, res) => {
  if (!requireTableEdit(req, res)) return;
  editorIsRunning()
    .then((running) =>
      res.json({
        url: config.tablesUrl,
        port: config.tablesPort,
        running,
        // Which command to offer, since the two deployments start it differently.
        command: config.isProduction ? "npm run start:tables" : "npm run dev:tables"
      })
    )
    .catch(() => res.json({ url: config.tablesUrl, port: config.tablesPort, running: false, command: "" }));
});
