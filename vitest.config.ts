import { configDefaults, defineConfig } from "vitest/config";

// A targeted `vitest run server/src/foo.test.ts` launched from this directory
// does not discover server/vitest.config.ts. Load the same database isolation
// here so the convenient root-level command can never reach `.data`.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ".claude/**"],
    setupFiles: ["./server/src/test-setup.ts"]
  }
});
