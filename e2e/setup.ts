import { expect, type APIRequestContext } from "@playwright/test";
import { FIXTURE_SYSTEM, bundleSystemRepo } from "../scripts/harness.mjs";

/** All specs share one server; each browser gets its own authenticated session. */
export async function prepareTable(request: APIRequestContext) {
  const credentials = { username: "BrowserTestGM", password: "browser-test-password" };
  const setup = await request.post("/api/setup", { data: credentials });
  expect([201, 409]).toContain(setup.status());
  if (setup.status() === 409) {
    expect((await request.post("/api/login", { data: credentials })).status()).toBe(200);
  }
  const { id: system, zip } = await bundleSystemRepo(FIXTURE_SYSTEM);
  const installed = await request.post("/api/admin/systems", {
    multipart: { bundle: { name: `${system}.devilsystem.zip`, mimeType: "application/zip", buffer: zip } }
  });
  expect([200, 201]).toContain(installed.status());
  return system;
}
