import { expect, request as apiRequest, test } from "@playwright/test";

test("GM configures shared calendar and persistent map notation", async ({ page }) => {
  const setup = await page.request.post("/api/setup", {
    data: { username: "CalendarGM", password: "calendar-test-password" }
  });
  expect(setup.status()).toBe(201);

  const created = await page.request.post("/api/rooms", {
    data: { name: "The Long Campaign", system: "cairn" }
  });
  expect(created.status()).toBe(201);
  const roomId = (await created.json()).room.id as number;

  expect(
    (
      await page.request.patch(`/api/rooms/${roomId}`, {
        data: { calendarEnabled: true, mapNotationEnabled: true }
      })
    ).status()
  ).toBe(204);
  expect(
    (
      await page.request.put(`/api/rooms/${roomId}/calendar`, {
        data: {
          year: 803,
          month: 1,
          day: 14,
          segment: 0,
          daysPerWeek: 5,
          daysPerMonth: 25,
          dayNames: ["Ember", "Stone", "River", "Gale", "Star"],
          monthNames: ["Deepfrost", "Thawrise", "Highsun"],
          segmentNames: ["Dawn", "Noon", "Dusk"],
          events: [
            { id: "market", name: "Market Day", cadence: "weekly", day: 4 },
            { id: "founding", name: "Founding Feast", cadence: "holiday", month: 1, day: 18 }
          ]
        }
      })
    ).status()
  ).toBe(200);

  const uploaded = await page.request.post(`/api/rooms/${roomId}/media`, {
    multipart: {
      kind: "map",
      file: {
        name: "campaign-map.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64"
        )
      }
    }
  });
  expect(uploaded.status()).toBe(201);
  const mapId = (await uploaded.json()).media.id as number;
  expect((await page.request.patch(`/api/rooms/${roomId}/map`, { data: { mediaId: mapId } })).status()).toBe(204);

  await page.goto("/");
  await page.getByRole("button", { name: "Open The Long Campaign, Game master" }).click();
  await expect(page.getByRole("heading", { name: "The Long Campaign" })).toBeVisible();
  await page.getByTitle("Calendar").click();

  await expect(page.getByRole("heading", { name: "Thawrise · Day 14" })).toBeVisible();
  await expect(page.getByText("Year 803")).toBeVisible();
  await expect(page.getByText("Dawn", { exact: true })).toBeVisible();
  await expect(page.getByText("Founding Feast")).toBeVisible();
  await expect(page.getByText("Market Day").first()).toBeVisible();
  await page.waitForTimeout(500); // Let the room-opening animation release its temporary containing block.
  await page.screenshot({ path: "test-results/calendar-desktop.png", fullPage: true });

  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/rooms/${roomId}/calendar/advance`)),
    page.locator(".calendar-day.current").click()
  ]);
  const advancedDetail = await page.request.get(`/api/rooms/${roomId}`);
  expect((await advancedDetail.json()).room.calendar.segment).toBe(1);
  await expect(page.getByText("Noon", { exact: true })).toBeVisible();

  await page.getByTitle("Configure calendar").click();
  await expect(page.getByRole("heading", { name: "Holidays & recurring events" })).toBeVisible();
  await expect(page.getByLabel("Names of days")).toHaveValue("Ember, Stone, River, Gale, Star");

  await page.getByLabel("Close calendar").click();
  await page.getByRole("button", { name: "Maps" }).click();
  await expect(page.getByAltText("campaign-map")).toBeVisible();
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  const map = page.locator(".scene-viewer");
  const bounds = await map.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width * 0.25, bounds!.y + bounds!.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * 0.7, bounds!.y + bounds!.height * 0.65, { steps: 12 });
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/rooms/${roomId}/maps/${mapId}/notations`)),
    page.mouse.up()
  ]);
  await expect(page.locator(".map-notation-layer polyline")).toHaveCount(1);
  const saved = await page.request.get(`/api/rooms/${roomId}/maps/${mapId}/notations`);
  expect((await saved.json()).notations).toHaveLength(1);
  const invitation = await page.request.post(`/api/rooms/${roomId}/invitations`, {
    data: { username: "MapPlayer" }
  });
  const token = (await invitation.json()).invitation.token as string;
  const player = await apiRequest.newContext({ baseURL: "http://127.0.0.1:4321" });
  expect(
    (await player.post(`/api/invitations/${token}/redeem`, { data: { password: "map-player-password" } })).status()
  ).toBe(200);
  const shared = await player.get(`/api/rooms/${roomId}/maps/${mapId}/notations`);
  expect((await shared.json()).notations).toHaveLength(1);
  expect((await player.delete(`/api/rooms/${roomId}/maps/${mapId}/notations`)).status()).toBe(403);
  expect((await player.post(`/api/rooms/${roomId}/characters`, { data: { name: "Ash the Scout" } })).status()).toBe(
    201
  );
  await player.dispose();
  await page.screenshot({ path: "test-results/map-notation-desktop.png", fullPage: true });

  await page.getByRole("button", { name: "Group" }).click();
  await page.getByRole("button", { name: "Group" }).click();
  await page.getByRole("option", { name: "Party Members" }).click();
  await expect(page.getByText("Ash the Scout", { exact: true })).toBeVisible();
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "People" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/group-presence-desktop.png", fullPage: true });

  await page.getByRole("button", { name: "Rules" }).click();
  await expect(page.getByRole("navigation", { name: "Rules headings" })).toBeVisible();
  await expect(page.getByTitle("Open rules in a new tab")).toHaveAttribute("target", "_blank");
  await expect(page.locator(".context-panel").getByRole("button", { name: "Rules" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/center-rules-desktop.png", fullPage: true });
});
