import { expect, test } from "@playwright/test";
import { prepareTable } from "./setup";

test("image references zoom, pan, fit, and reuse cached originals", async ({ page }) => {
  const system = await prepareTable(page.request);
  const created = await page.request.post("/api/rooms", { data: { name: "Reference Room", system } });
  const roomId = (await created.json()).room.id;
  const uploaded = await page.request.post(`/api/rooms/${roomId}/media`, {
    multipart: {
      kind: "reference",
      file: {
        name: "handout.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64"
        )
      }
    }
  });
  expect(uploaded.status()).toBe(201);
  const asset = (await uploaded.json()).media;
  expect((await page.request.post(`/api/rooms/${roomId}/references/${asset.id}/reveal`)).status()).toBe(204);
  const open = async () => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open Reference Room, Game master" }).click();
    await page.getByRole("button", { name: "References", exact: true }).click();
  };
  await open();
  const viewer = page.locator(".table-reference-view .scene-viewer");
  const image = viewer.locator(":scope > img");
  await expect(viewer).toBeVisible();
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
  await viewer.getByTitle("Zoom in", { exact: true }).click();
  await expect(image).toHaveCSS("transform", "matrix(1.5, 0, 0, 1.5, 0, 0)");
  await viewer.getByTitle("Zoom out", { exact: true }).click();
  await expect(image).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  const box = (await viewer.boundingBox())!;
  const x = box.x + box.width / 2 + 30;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -100);
  await expect(image).toHaveCSS("transform", /matrix\(1\.25,/);
  await page.mouse.down();
  await page.mouse.move(x + 50, y + 30, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(() => image.evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).f))
    .toBeCloseTo(30, 0);
  await viewer.getByTitle("Fit Reference").click();
  await expect(image).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  await open();
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete)).toBe(true);
  const transfer = await page.evaluate((url) => {
    const entries = performance.getEntriesByName(new URL(url, location.href).href) as PerformanceResourceTiming[];
    return entries.at(-1)?.transferSize;
  }, asset.url);
  expect(transfer).toBe(0);
});
