import { expect, test } from "@playwright/test";
import { prepareTable } from "./setup";

test("an account link signs out its visitor, sets a password, and returns to normal login", async ({ page }) => {
  await prepareTable(page.request);
  const username = "ResetLinkPlayer";
  const created = await page.request.post("/api/management/players", {
    data: { username, password: "original-password", role: "player" }
  });
  expect(created.status()).toBe(201);
  await page.goto("/");
  await page.getByRole("button", { name: "Management Setup & systems", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Management sections" })
    .getByRole("button", { name: /^Accounts/ })
    .click();
  await page.getByRole("button").filter({ hasText: username }).click();
  await page.getByRole("button", { name: "Create reset link", exact: true }).click();
  const link = await page.getByLabel("Share this link").inputValue();
  expect(link).toContain("/reset-password#token=");

  // The admin's browser opens the player's link, as a different logged-in user.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(link);
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  expect((await page.request.get("/api/me")).status()).toBe(401);
  expect(new URL(page.url()).hash).toBe(new URL(link).hash);
  await page.reload();
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  expect(new URL(page.url()).hash).toBe(new URL(link).hash);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel("New password", { exact: true }).fill("chosen-password");
  await page.getByLabel("Confirm password").fill("mismatched-password");
  await page.getByRole("button", { name: "Save password", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Passwords do not match.");
  await page.getByLabel("Confirm password").fill("chosen-password");
  await page.getByRole("button", { name: "Save password", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Password saved" })).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  expect((await page.request.get("/api/me")).status()).toBe(401);
  await page.getByRole("link", { name: "Continue to sign in" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill("chosen-password");
  await page.getByRole("button", { name: "Enter the table", exact: true }).click();
  await expect.poll(async () => (await page.request.get("/api/me")).status()).toBe(200);

  await page.goto(link);
  await expect(page.getByRole("alert")).toContainText("invalid or expired");
  expect((await page.request.get("/api/me")).status()).toBe(401);
});
