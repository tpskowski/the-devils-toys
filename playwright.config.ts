import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const port = 4321;
const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), ".visual-playwright");

/**
 * A run starts from an empty server, so the data directory goes first.
 *
 * Done here rather than in the command because this file is TypeScript run by
 * Node, and Node deletes a directory the same way everywhere. The command used
 * to open with `rm -rf`, which meant the suite could not start on Windows —
 * where `cmd` has no such thing — and so had never run there at all.
 *
 * Only in the runner. Playwright reads this file again inside each worker, by
 * which time the server it started is holding the database open; on Windows
 * that second delete fails outright rather than being a no-op.
 */
if (process.env.TEST_WORKER_INDEX === undefined) {
  fs.rmSync(dataDir, { recursive: true, force: true });
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROME_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH }
      : undefined
  },
  webServer: {
    // `&&` is the one operator both `sh` and `cmd` agree on. Everything else the
    // server needs is passed as environment rather than written into the line,
    // since `VAR=value command` is shell syntax that `cmd` does not have.
    command: "npm run build && node server/dist/index.js",
    env: {
      NODE_ENV: "production",
      PORT: String(port),
      DEVILS_TOYS_DATA_DIR: dataDir,
      // No catalogue: a test run must not depend on what someone published, or
      // on the network being there at all.
      DEVILS_TOYS_SYSTEM_CATALOG_URL: ""
    },
    url: `http://127.0.0.1:${port}/api/status`,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
