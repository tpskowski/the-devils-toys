import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const sensitive = /password|token|secret|authorization|cookie/i;
const levels = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof levels;
const threshold = levels[config.logLevel as Level] ?? levels.info;
const logFile = path.join(config.dataDir, "logs", "server.log");
fs.mkdirSync(path.dirname(logFile), { recursive: true });

export function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, sensitive.test(key) ? "[redacted]" : sanitize(child)])
    );
  }
  return value;
}

function write(level: Level, message: string, data?: unknown) {
  if (levels[level] < threshold) return;
  const entry = { time: new Date().toISOString(), level, message, ...(data ? { data: sanitize(data) } : {}) };
  const line = `${JSON.stringify(entry)}\n`;
  process.stdout.write(line);
  try {
    fs.appendFileSync(logFile, line, "utf8");
  } catch (error) {
    process.stderr.write(`Unable to write local log: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

export const logger = {
  debug: (message: string, data?: unknown) => write("debug", message, data),
  info: (message: string, data?: unknown) => write("info", message, data),
  warn: (message: string, data?: unknown) => write("warn", message, data),
  error: (message: string, data?: unknown) => write("error", message, data)
};
