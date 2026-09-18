import { expect, test } from "@playwright/test";
import { prepareTable } from "./setup";

test("GM simulates players and returns to the room in the same tab", async ({ page, context, browser }) => {
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
  await expect(page.getByLabel("Player to preview")).toHaveCount(0);
  await page.getByRole("button", { name: "Simulate", exact: true }).click();
  await page.getByLabel("Player to preview").selectOption(String(alice.accountId));
  const pageCount = context.pages().length;
  await page.getByRole("link", { name: "Start simulating", exact: true }).click();
  const preview = page;
  await expect(preview.getByRole("button", { name: "Simulating · Read-only" })).toBeVisible();
  await expect(preview.getByLabel("Player to preview")).toHaveCount(0);
  await preview.getByRole("button", { name: "Simulating · Read-only" }).click();
  await expect(preview.getByLabel("Player to preview")).toHaveValue(String(alice.accountId));
  await expect(preview.getByTitle("Bestiary", { exact: true })).toHaveCount(0);
  expect(context.pages()).toHaveLength(pageCount);
  await preview.getByLabel("Player to preview").selectOption("generic");
  await preview.getByRole("link", { name: "View as player", exact: true }).click();
  await expect(preview).toHaveURL(new RegExp(`previewRoom=${roomId}&previewPlayer=generic`));
  await preview.setViewportSize({ width: 390, height: 844 });
  await expect(preview.getByRole("link", { name: "Stop simulating" })).toBeVisible();
  await preview.getByRole("button", { name: "Simulating · Read-only" }).click();
  await expect(preview.getByLabel("Player to preview")).toHaveValue("generic");
  await expect(preview.getByLabel("Player to preview")).toBeVisible();
  expect(await preview.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const response = await preview.request.post(`/api/player-preview/${roomId}/generic/rooms/${roomId}/messages`, {
    data: { body: "Preview cannot post" }
  });
  expect(response.status()).toBe(403);
  expect((await (await page.request.get("/api/me")).json()).account.role).toBe("admin");
  await preview.getByRole("dialog").getByRole("link", { name: "Stop simulating" }).click();
  await expect(preview).toHaveURL(new RegExp(`\\?room=${roomId}$`));
  await expect(preview.getByRole("button", { name: "Simulate", exact: true })).toBeVisible();
  await expect(preview.getByTitle("Bestiary", { exact: true })).toBeVisible();
  await expect(preview.getByRole("heading", { name: "Preview Campaign", exact: true })).toBeVisible();
  expect(context.pages()).toHaveLength(pageCount);
});
