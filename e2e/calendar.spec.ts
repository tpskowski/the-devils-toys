import { expect, request as apiRequest, test } from "@playwright/test";
import { FIXTURE_SYSTEM, bundleSystemRepo } from "../scripts/harness.mjs";

test("GM configures shared calendar and persistent map notation", async ({ page }) => {
  const setup = await page.request.post("/api/setup", {
    data: { username: "CalendarGM", password: "calendar-test-password" }
  });
  expect(setup.status()).toBe(201);

  // This application ships no game system, so the run installs the one it tests
  // with before it can make a room on anything.
  const { id: system, zip } = await bundleSystemRepo(FIXTURE_SYSTEM);
  const installed = await page.request.post("/api/admin/systems", {
    multipart: { bundle: { name: `${system}.devilsystem.zip`, mimeType: "application/zip", buffer: zip } }
  });
  expect(installed.status()).toBe(201);

  const created = await page.request.post("/api/rooms", {
    data: { name: "The Long Campaign", system }
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
            // Three days long and started before this page opens on it, so it
            // is on the calendar as a run rather than as a single day.
            { id: "founding", name: "Founding Feast", cadence: "holiday", month: 1, day: 13, durationDays: 3 },
            { id: "raid", name: "Raiders Arrive", cadence: "holiday", month: 1, day: 20, hidden: true },
            // Anchored to Thawrise 6, so it runs 6-10 and again 16-20 in a
            // five-day week — every other week, counted from a day the GM chose.
            {
              id: "night",
              name: "Night",
              cadence: "biweekly",
              startYear: 803,
              month: 1,
              day: 6,
              durationDays: 5
            },
            // Every three days from Thawrise 2: 2, 5, 8, 11 and on.
            { id: "tithe", name: "Tithe", cadence: "interval", startYear: 803, month: 1, day: 2, intervalDays: 3 },
            // A weekday of 15 in a five-day week: the shape a GM lands on by
            // reading "Day" as the day of the week. It can never happen.
            { id: "muster", name: "Muster", cadence: "weekly", day: 15 }
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

  // The month and year are the page controls; the current clock stays separate
  // so browsing another month never makes that month look like today.
  await expect(page.getByLabel("Displayed month")).toHaveValue("1");
  await expect(page.getByLabel("Displayed year")).toHaveValue("803");
  await expect(page.locator(".calendar-now")).toContainText("Thawrise 14, 803");
  await expect(page.locator(".calendar-view-controls")).toHaveCount(0);
  // The segment carries its position as well as its name, so this is the whole
  // label rather than just "Dawn".
  await expect(page.getByText("Dawn · 1 of 3", { exact: true })).toBeVisible();
  // A three-day feast is on all three of its days, and the GM alone is shown
  // the raid — a player's calendar never carries it at all.
  await expect(page.getByText("Founding Feast")).toHaveCount(3);
  // Five days from the 6th, then the fortnight off, then five from the 16th.
  await expect(page.getByText("Night")).toHaveCount(10);
  await expect(page.getByTitle("Night · day 5 of 5")).toHaveCount(2);
  // Every three days: 2, 5, 8, 11, 14, 17, 20, 23 in a twenty-five day month.
  await expect(page.getByText("Tithe")).toHaveCount(8);
  await expect(page.getByText("Muster")).toHaveCount(0);
  await expect(page.getByTitle("Founding Feast · day 2 of 3")).toBeVisible();
  await expect(page.getByText("Market Day").first()).toBeVisible();
  await expect(page.getByText("Raiders Arrive")).toBeVisible();
  await page.waitForTimeout(500); // Let the room-opening animation release its temporary containing block.
  await page.screenshot({ path: "test-results/calendar-desktop.png", fullPage: true });

  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/rooms/${roomId}/calendar/advance`)),
    page.getByRole("button", { name: "1 segment", exact: true }).click()
  ]);
  const advancedDetail = await page.request.get(`/api/rooms/${roomId}`);
  expect((await advancedDetail.json()).room.calendar.segment).toBe(1);
  await expect(page.getByText("Noon · 2 of 3", { exact: true })).toBeVisible();

  // Reading another month leaves the separate current-time readout alone.
  await page.getByLabel("Displayed month").selectOption("2");
  await expect(page.locator(".calendar-heading")).toContainText("Highsun");
  await expect(page.locator(".calendar-now")).toContainText("Thawrise 14, 803");
  await page.getByLabel("Displayed month").selectOption("1");
  await expect(page.locator(".calendar-heading")).toContainText("Thawrise");
  await expect(page.locator(".calendar-now")).toContainText("Thawrise 14, 803");

  await page.getByTitle("Configure calendar").click();
  await expect(page.getByRole("heading", { name: "Calendar entries" })).toBeVisible();
  await expect(page.getByLabel("Names of days")).toHaveValue("Ember, Stone, River, Gale, Star");
  // Both new controls sit on the event itself, and the hide switch says which
  // way pressing it goes rather than which state the event is in.
  await expect(page.getByLabel("Days Founding Feast lasts")).toHaveValue("3");
  await expect(page.getByTitle("Hide Market Day from players")).toBeVisible();
  await expect(page.getByTitle("Show Raiders Arrive to players")).toBeVisible();
  // Every other week is two of this calendar's own weeks, and the anchor is a
  // date rather than a phase inherited from counting since year one.
  await expect(page.getByLabel("Year Night starts in")).toHaveValue("803");
  await expect(page.getByLabel("Days between each Tithe")).toHaveValue("3");
  // An event with nowhere to fall says so where it is edited, rather than being
  // absent from the calendar and leaving the GM to work out why.
  await expect(
    page.getByText("A week is 5 days long, so there is no day 15 for this to fall on. It never happens.")
  ).toBeVisible();

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
  // Only the saved notations: the layer also holds a draft polyline at all times,
  // which is what a line being drawn is rendered into.
  await expect(page.locator(".map-notation-layer polyline[data-notation-id]")).toHaveCount(1);
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
  const playerCalendar = (await (await player.get(`/api/rooms/${roomId}`)).json()).room.calendar;
  expect(playerCalendar.events.map((event: { id: string }) => event.id)).toEqual([
    "market",
    "founding",
    "night",
    "tithe",
    "muster"
  ]);
  expect(playerCalendar.events[1]).toMatchObject({ durationDays: 3, hidden: false });

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
