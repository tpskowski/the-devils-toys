import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export const projectRoot = path.resolve(moduleDirectory, "..", "..");

export function projectFile(...segments: string[]) {
  return path.resolve(projectRoot, ...segments);
}
