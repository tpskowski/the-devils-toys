import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

// Importing anything that reaches db.ts opens a database, so tests must never
// run against the configured data directory. Each test file gets a throwaway
// directory; tests that need a specific starting schema override this before
// importing db.ts themselves.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "devils-toys-test-"));
process.env.DEVILS_TOYS_DATA_DIR = dataDir;
// A server comes configured with the published catalogue. Tests must never reach
// for it: that would make them slower, flakier, and dependent on what someone
// else published. Anything testing the catalogue supplies its own.
process.env.DEVILS_TOYS_SYSTEM_CATALOG_URL = "";

afterAll(() => {
  removeDataDir(dataDir);
});

export function removeDataDir(directory: string) {
  try {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // A still-open database handle keeps its file locked on Windows. Leaving a
    // temporary directory behind must never fail an otherwise passing suite.
  }
}
