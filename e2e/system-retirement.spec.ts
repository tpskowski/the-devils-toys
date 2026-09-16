import { expect, test } from "@playwright/test";
import { prepareTable } from "./setup";

test("a retired system's existing room still opens and rolls its rulebook tables", async ({ page }) => {
  const system = await prepareTable(page.request);
  const created = await page.request.post("/api/rooms", { data: { name: "Retired system campaign", system } });
  expect(created.status()).toBe(201);
  expect((await page.request.post(`/api/admin/systems/${system}/retire`)).status()).toBe(200);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Open Retired system campaign, Game master" }).click();
    await expect(page.getByRole("heading", { name: "Retired system campaign", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Group", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Rules", exact: true }).click();
    await page.locator(".rules-table-link").first().click();
    const dialog = page.getByRole("dialog", { name: "Rules table" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /^Public d/ }).click();
    await expect(dialog.getByRole("status")).toBeVisible();
    expect(errors).toEqual([]);
    const status = await (await page.request.get("/api/status")).json();
    expect(status.systems.some((entry: { id: string }) => entry.id === system)).toBe(false);
  } finally {
    // The browser suite shares its fixture with later specs.
    expect((await page.request.post(`/api/admin/systems/${system}/restore`)).status()).toBe(200);
  }
});
