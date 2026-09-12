import { expect, test } from "@playwright/test";
import { prepareTable } from "./setup";

test("GM opens a scoped player preview in a separate tab and switches players", async ({ page, context, browser }) => {
  const system = await prepareTable(page.request);
  const created = await page.request.post("/api/rooms", { data: { name: "Preview Campaign", system } });
  const roomId = (await created.json()).room.id;
  const invitation = await page.request.post(`/api/rooms/${roomId}/invitations`, {
    data: { username: "PreviewAlice" }
  });
  expect(invitation.status()).toBe(201);
  const playerContext = await browser.newContext();
  const token = (await invitation.json()).invitation.token;
  const redeemed = await playerContext.request.post(`http://127.0.0.1:4321/api/invitations/${token}/redeem`, {
    data: { password: "preview-player-password" }
  });
  expect(redeemed.ok()).toBe(true);
  await playerContext.close();
  const detail = await (await page.request.get(`/api/rooms/${roomId}`)).json();
  const alice = detail.members.find((member: { username: string }) => member.username === "PreviewAlice");
  expect(alice).toBeTruthy();
  await page.goto("/");
  await page.getByRole("button", { name: "Open Preview Campaign, Game master" }).click();
  await page.getByLabel("Player to preview").selectOption(String(alice.accountId));
  const opened = context.waitForEvent("page");
  await page.getByRole("link", { name: "Player preview", exact: true }).click();
  const preview = await opened;
  await expect(preview.getByText("Player preview · Read-only", { exact: true })).toBeVisible();
  await expect(preview.getByLabel("Preview player")).toHaveValue(String(alice.accountId));
  await expect(preview.getByTitle("Bestiary", { exact: true })).toHaveCount(0);
  await expect(page.getByTitle("Bestiary", { exact: true })).toBeVisible();
  await preview.getByLabel("Preview player").selectOption("generic");
  await expect(preview.getByLabel("Preview player")).toHaveValue("generic");
  await preview.setViewportSize({ width: 390, height: 844 });
  await expect(preview.getByLabel("Preview player")).toBeVisible();
  expect(await preview.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const response = await preview.request.post(`/api/player-preview/${roomId}/generic/rooms/${roomId}/messages`, {
    data: { body: "Preview cannot post" }
  });
  expect(response.status()).toBe(403);
  expect((await (await page.request.get("/api/me")).json()).account.role).toBe("admin");
  await preview.close();
});
