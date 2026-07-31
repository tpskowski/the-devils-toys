import { defineConfig } from "@playwright/test";

const port = 4321;

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
    command:
      "rm -rf .visual-playwright && npm run build && NODE_ENV=production PORT=4321 DEVILS_TOYS_DATA_DIR=.visual-playwright node server/dist/index.js",
    url: `http://127.0.0.1:${port}/api/status`,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
