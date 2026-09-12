import { expect, test } from "@playwright/test";
import { prepareTable } from "./setup";

test("portrait modal contains focus and returns it after every dismissal", async ({ page }) => {
  const system = await prepareTable(page.request);
  const created = await page.request.post("/api/rooms", { data: { name: "Portrait Room", system } });
  expect(created.status()).toBe(201);
  const roomId = (await created.json()).room.id;
  const character = await page.request.post(`/api/rooms/${roomId}/characters`, {
    data: { name: "Orchid", sheet: {} }
  });
  expect(character.status()).toBe(201);
  const characterId = (await character.json()).character.id;
  const uploaded = await page.request.post(`/api/rooms/${roomId}/characters/${characterId}/portrait`, {
    multipart: {
      file: {
        name: "orchid.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64"
        )
      }
    }
  });
  expect(uploaded.status()).toBe(201);
  await page.goto("/");
  await page.getByRole("button", { name: "Open Portrait Room, Game master" }).click();
  await page.getByTitle("Manage characters").click();
  const trigger = page.getByRole("button", { name: "View Orchid portrait full size" });
  const lightbox = page.locator("dialog.portrait-lightbox");
  const close = page.getByRole("button", { name: "Close full-size portrait" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  // Native modal inertness prevents even explicit focus on underlying inputs.
  await page
    .locator(".character-sheet input")
    .first()
    .evaluate((input: HTMLInputElement) => input.focus());
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(lightbox).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("dialog", { name: "Characters", exact: true })).toBeVisible();
  await trigger.click();
  await close.click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await lightbox.click({ position: { x: 2, y: 2 } });
  await expect(lightbox).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
