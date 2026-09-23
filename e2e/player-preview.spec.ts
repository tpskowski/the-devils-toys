import { expect, test } from "@playwright/test";
import { prepareTable } from "./setup";

test("GM simulates players and returns to the room in the same tab", async ({ page, context, browser }) => {
  const system = await prepareTable(page.request);
  const created = await page.request.post("/api/rooms", { data: { name: "Preview Campaign", system } });
  const roomId = (await created.json()).room.id;
  const uploaded = await page.request.post(`/api/rooms/${roomId}/media`, {
    multipart: {
      kind: "scene",
      file: {
        name: "preview-scene.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64"
        )
      }
    }
  });
  expect(uploaded.status()).toBe(201);
  const image = (await uploaded.json()).media;
  expect((await page.request.patch(`/api/rooms/${roomId}/scene`, { data: { mediaId: image.id } })).ok()).toBe(true);
  expect(
    (await page.request.patch(`/api/rooms/${roomId}/media/${image.id}/visibility`, { data: { visible: true } })).ok()
  ).toBe(true);
  const network = await context.newCDPSession(page);
  await network.send("Network.enable");
  const cachedRequests = new Set<string>();
  const imageResponses: { id: string; cached: boolean }[] = [];
  network.on("Network.requestServedFromCache", ({ requestId }) => cachedRequests.add(requestId));
  network.on("Network.responseReceived", ({ requestId, response }) => {
    if (response.url.endsWith(image.url))
      imageResponses.push({ id: requestId, cached: Boolean(response.fromDiskCache) });
  });
  const loadedImage = async () => {
    await expect
      .poll(() =>
        page.locator(".table-media-panel .scene-viewer > img").evaluate((img: HTMLImageElement) => img.naturalWidth)
      )
      .toBeGreaterThan(0);
  };
  const cachedImage = async () => {
    await loadedImage();
    expect(imageResponses.length).toBeGreaterThan(0);
    expect(imageResponses.every((response) => response.cached || cachedRequests.has(response.id))).toBe(true);
    imageResponses.length = 0;
  };
  const invitation = await page.request.post(`/api/rooms/${roomId}/invitations`, {
    data: { username: "PreviewAlice" }
  });
  expect(invitation.status()).toBe(201);
  const playerContext = await browser.newContext();
  const token = (await invitation.json()).invitation.token;
  const redeemed = await playerContext.request.post(new URL(`/api/invitations/${token}/redeem`, created.url()).href, {
    data: { password: "preview-player-password" }
  });
  expect(redeemed.ok()).toBe(true);
  await playerContext.close();
  const detail = await (await page.request.get(`/api/rooms/${roomId}`)).json();
  const alice = detail.members.find((member: { username: string }) => member.username === "PreviewAlice");
  expect(alice).toBeTruthy();
  await page.goto("/");
  await page.getByRole("button", { name: "Open Preview Campaign, Game master" }).click();
  await loadedImage();
  imageResponses.length = 0;
  await expect(page.getByRole("button", { name: "Simulate", exact: true })).toHaveCSS("height", "39px");
  await expect(page.getByLabel("Player to preview")).toHaveCount(0);
  await page.getByRole("button", { name: "Simulate", exact: true }).click();
  await page.getByLabel("Player to preview").selectOption(String(alice.accountId));
  const pageCount = context.pages().length;
  await page.getByRole("link", { name: "Start simulating", exact: true }).click();
  const preview = page;
  await expect(preview.getByRole("button", { name: "Change simulated player" })).toBeVisible();
  await cachedImage();
  await expect(preview.getByLabel("Player to preview")).toHaveCount(0);
  await preview.getByRole("button", { name: "Change simulated player" }).click();
  await expect(preview.getByLabel("Player to preview")).toHaveValue(String(alice.accountId));
  await expect(preview.getByTitle("Bestiary", { exact: true })).toHaveCount(0);
  expect(context.pages()).toHaveLength(pageCount);
  await preview.getByLabel("Player to preview").selectOption("generic");
  await preview.getByRole("link", { name: "View as player", exact: true }).click();
  await expect(preview).toHaveURL(new RegExp(`previewRoom=${roomId}&previewPlayer=generic`));
  await cachedImage();
  await preview.setViewportSize({ width: 390, height: 844 });
  await expect(preview.getByRole("link", { name: "Stop simulating" })).toBeVisible();
  await expect(preview.locator(".simulation-stop .simulation-label-short")).toBeVisible();
  await expect(preview.getByRole("link", { name: "Stop simulating" })).toHaveCSS("height", "35px");
  await expect(preview.getByRole("button", { name: "Change simulated player" })).toHaveCSS("height", "35px");
  await preview.getByRole("button", { name: "Change simulated player" }).click();
  await expect(preview.getByLabel("Player to preview")).toHaveValue("generic");
  await expect(preview.getByLabel("Player to preview")).toBeVisible();
  expect(await preview.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const response = await preview.request.post(`/api/player-preview/${roomId}/generic/rooms/${roomId}/messages`, {
    data: { body: "Preview cannot post" }
  });
  expect(response.status()).toBe(403);
  expect((await (await page.request.get("/api/me")).json()).account.role).toBe("admin");
  const dialog = preview.getByRole("dialog");
  await expect(dialog.getByRole("link", { name: "Stop simulating" })).toHaveCSS("min-height", "44px");
  await expect(dialog.getByRole("link", { name: "View as player" })).toHaveCSS("min-height", "44px");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await preview.getByRole("link", { name: "Stop simulating" }).click();
  await expect(preview).toHaveURL(new RegExp(`\\?room=${roomId}$`));
  await expect(preview.getByRole("button", { name: "Simulate", exact: true })).toBeVisible();
  await expect(preview.getByTitle("Bestiary", { exact: true })).toBeVisible();
  await expect(preview.getByRole("heading", { name: "Preview Campaign", exact: true })).toBeVisible();
  await cachedImage();
  expect(context.pages()).toHaveLength(pageCount);
});
