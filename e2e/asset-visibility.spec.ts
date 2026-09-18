import { expect, test } from "@playwright/test";
import { prepareTable } from "./setup";

test("GM toolbar confirms visibility and activation; players see only revealed assets", async ({ page, browser }) => {
  const system = await prepareTable(page.request);
  const created = await page.request.post("/api/rooms", { data: { name: "Visibility Room", system } });
  const roomId = (await created.json()).room.id;
  const upload = async (kind: string, name: string) => {
    const response = await page.request.post(`/api/rooms/${roomId}/media`, {
      multipart: {
        kind,
        file: {
          name,
          mimeType: "image/png",
          buffer: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            "base64"
          )
        }
      }
    });
    expect(response.status()).toBe(201);
    const asset = (await response.json()).media;
    await page.request.patch(`/api/rooms/${roomId}/media/${asset.id}/visibility`, { data: { visible: false } });
    return asset;
  };
  const scene = await upload("scene", "Courtyard.png");
  const map = await upload("map", "Floorplan.png");
  await upload("reference", "Letter.png");
  await page.request.patch(`/api/rooms/${roomId}/scene`, { data: { mediaId: null } });
  const invitation = await page.request.post(`/api/rooms/${roomId}/invitations`, {
    data: { username: "VisibilityPlayer" }
  });
  const token = (await invitation.json()).invitation.token;
  const playerContext = await browser.newContext({ baseURL: "http://127.0.0.1:4321" });
  try {
    expect(
      (
        await playerContext.request.post(`/api/invitations/${token}/redeem`, {
          data: { password: "visibility-password" }
        })
      ).ok()
    ).toBe(true);
    const playerMedia = async () => await (await playerContext.request.get(`/api/rooms/${roomId}/media`)).json();
    expect((await playerMedia()).library).toHaveLength(0);
    await page.goto("/");
    await page.getByRole("button", { name: "Open Visibility Room, Game master" }).click();
    const eye = page.getByRole("button", { name: /Courtyard: .*Change visibility/ });
    const dialog = page.getByRole("dialog", { name: "Visibility: Courtyard" });
    await eye.click();
    await expect(dialog.getByRole("button", { name: "Reveal", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Reveal and make active", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(eye).toBeFocused();
    expect((await playerMedia()).library).toHaveLength(0);
    await eye.click();
    await dialog.getByRole("button", { name: "Reveal", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect((await playerMedia()).scene).toBeNull();
    await eye.click();
    await dialog.getByRole("button", { name: "Make active", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect((await playerMedia()).scene.id).toBe(scene.id);
    await eye.click();
    await expect(dialog.getByRole("button", { name: "Make active", exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Hide", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect((await playerMedia()).library).toHaveLength(0);
    await page.getByRole("button", { name: "Maps", exact: true }).click();
    await page.getByRole("button", { name: /Floorplan: Hidden from players/ }).click();
    const mapDialog = page.getByRole("dialog", { name: "Visibility: Floorplan" });
    await mapDialog.getByRole("button", { name: "Reveal and make active", exact: true }).click();
    await expect(mapDialog).toHaveCount(0);
    expect((await playerMedia()).map.id).toBe(map.id);
    await page.getByRole("button", { name: "References", exact: true }).click();
    await page.getByRole("button", { name: /Letter: Hidden from players/ }).click();
    const referenceDialog = page.getByRole("dialog", { name: "Visibility: Letter" });
    await expect(referenceDialog.getByRole("button", { name: /active/i })).toHaveCount(0);
    await referenceDialog.getByRole("button", { name: "Reveal", exact: true }).click();
    await expect(referenceDialog).toHaveCount(0);
    const player = await playerContext.newPage();
    await player.goto("/");
    await player.getByRole("button", { name: /Open Visibility Room/ }).click();
    await player.getByRole("button", { name: "References", exact: true }).click();
    await expect(player.locator(".table-reference-view img")).toBeVisible();
    await expect(player.getByRole("button", { name: /Change visibility/ })).toHaveCount(0);
    expect(
      (
        await playerContext.request.patch(`/api/rooms/${roomId}/media/${scene.id}/visibility`, {
          data: { visible: true }
        })
      ).status()
    ).toBe(403);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".mobile-tabs").getByRole("button", { name: "Scene", exact: true }).click();
    await page.getByRole("button", { name: /Letter: Revealed to players/ }).click();
    await expect(referenceDialog).toBeVisible();
    const bounds = await referenceDialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: ".tmp-local-server/asset-visibility-mobile.png" });
    await page.keyboard.press("Escape");
    await expect(referenceDialog).toHaveCount(0);
  } finally {
    await playerContext.close();
  }
});
