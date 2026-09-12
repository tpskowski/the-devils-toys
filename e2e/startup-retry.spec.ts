import { expect, test } from "@playwright/test";
import { prepareTable } from "./setup";

test("startup recovers from failed status and session requests without signing out", async ({ page }) => {
  await prepareTable(page.request);
  let statusAttempts = 0;
  let sessionAttempts = 0;
  await page.route("**/api/status", (route) => {
    statusAttempts++;
    if (statusAttempts === 1) return route.abort("connectionrefused");
    if (statusAttempts === 2) return route.fulfill({ status: 200, contentType: "text/html", body: "Restarting" });
    return route.continue();
  });
  await page.route("**/api/me", (route) => {
    sessionAttempts++;
    return sessionAttempts === 1 ? route.fulfill({ status: 503, body: "Restarting" }) : route.continue();
  });
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("Waiting for the server. Retrying automatically…");
  await expect(page.getByRole("button", { name: "Enter the table", exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Rooms" })).toBeVisible({ timeout: 20_000 });
  expect(statusAttempts).toBeGreaterThanOrEqual(4);
  expect(sessionAttempts).toBe(2);
});

test("Retry now bypasses the startup delay", async ({ page }) => {
  await prepareTable(page.request);
  let available = false;
  await page.route("**/api/status", (route) =>
    available ? route.continue() : route.fulfill({ status: 503, body: "Restarting" })
  );
  await page.goto("/");
  await expect(page.getByRole("status")).toBeVisible();
  available = true;
  await page.getByRole("button", { name: "Retry now" }).click();
  await expect(page.getByRole("navigation", { name: "Rooms" })).toBeVisible();
});

test("a stalled startup request times out and retries", async ({ page }) => {
  await prepareTable(page.request);
  let attempts = 0;
  await page.route("**/api/status", (route) => {
    attempts++;
    if (attempts === 1) return; // Leave the first request pending until the client aborts it.
    return route.continue();
  });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Rooms" })).toBeVisible({ timeout: 20_000 });
  expect(attempts).toBe(2);
});
