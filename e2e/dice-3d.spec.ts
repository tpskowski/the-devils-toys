import { expect, test } from "@playwright/test";
import { DICE_SHAPES, DICE_THEMES, DEFAULT_DICE_PREFERENCES, diceAppearance } from "../shared/src/dice-3d";
import { prepareTable } from "./setup";
import { bundleSystemRepo, MINIMAL_SYSTEM } from "../scripts/harness.mjs";
import { simulateDice } from "../shared/src/dice-physics";
import type { PresentedDie } from "../shared/src/dice-3d";

test("3D dice: room gate, preferences, all shapes, bounded desktop/mobile rendering and fallback", async ({
  page
}, testInfo) => {
  test.setTimeout(60000);
  await page.clock.install();
  const system = await prepareTable(page.request);
  const created = await (await page.request.post("/api/rooms", { data: { name: "3D Dice Workshop", system } })).json();
  const roomId = created.room.id;
  expect(created.room.dice3dEnabled).toBe(false);
  const disabled = await (
    await page.request.post(`/api/rooms/${roomId}/rolls`, { data: { expression: "d16" } })
  ).json();
  expect(disabled.diceAnimations).toEqual([]);
  await page.goto("/");
  await page.getByRole("button", { name: "Open 3D Dice Workshop, Game master" }).click();
  await page.getByTitle("Room settings", { exact: true }).click();
  await expect(page.locator(".room-dice-theme summary")).toHaveCount(0);
  await page.getByRole("checkbox", { name: /^3D dice / }).check();
  await page.locator(".room-dice-theme summary").click();
  await page.getByRole("option", { name: "Grim Adventure", exact: true }).click();
  await page.getByRole("checkbox", { name: /^3D dice / }).uncheck();
  await expect(page.locator(".room-dice-theme summary")).toHaveCount(0);
  await page.getByRole("checkbox", { name: /^3D dice / }).check();
  await expect(page.locator(".room-dice-theme summary")).toHaveAttribute("aria-label", "Dice theme: Grim Adventure");
  await page.locator(".room-dice-theme summary").scrollIntoViewIfNeeded();
  const themeFields = page.locator(".settings-list > .theme-field");
  await expect(themeFields.nth(0)).toContainText("Theme");
  await expect(themeFields.nth(1)).toContainText("Dice theme");
  await page.locator(".room-dice-theme summary").click();
  await expect(page.getByRole("listbox", { name: "Dice themes", exact: true }).getByRole("option")).toHaveCount(7);
  const dicePalette = page.locator(".room-dice-theme summary .dice-theme-palette");
  const paletteBounds = await dicePalette.boundingBox();
  const lastSwatch = await dicePalette.locator(":scope > span").last().boundingBox();
  expect(lastSwatch!.x + lastSwatch!.width).toBeCloseTo(paletteBounds!.x + paletteBounds!.width, 0);
  await page.screenshot({ path: testInfo.outputPath("dice-room-settings.png"), animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("dice-room-settings-phone.png"), animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator(".room-dice-theme summary").press("Escape");
  await expect(page.getByRole("listbox", { name: "Dice themes", exact: true })).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect
    .poll(async () => (await (await page.request.get(`/api/rooms/${roomId}`)).json()).room.dice3dEnabled)
    .toBe(true);
  expect((await (await page.request.get(`/api/rooms/${roomId}`)).json()).room.dice3dTheme).toBe("grim");
  await page.getByTitle("Room settings", { exact: true }).click();
  await expect(page.locator(".room-dice-theme summary")).toHaveAttribute("aria-label", "Dice theme: Grim Adventure");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Roll dice", exact: true }).click();
  await page.getByRole("button", { name: "Your 3D dice", exact: false }).click();
  await page.getByRole("combobox", { name: "Dice set", exact: true }).selectOption("shinji");
  await page.getByRole("button", { name: "Save dice preferences", exact: true }).click();
  await expect
    .poll(async () => (await (await page.request.get("/api/me/dice")).json()).preferences.theme)
    .toBe("shinji");
  await page.screenshot({ path: testInfo.outputPath("dice-preferences.png") });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const canvas = page.locator(".dice-canvas canvas");
  const animation = {
    version: 1,
    id: "gallery",
    roomId,
    accountId: 1,
    createdAt: Date.now(),
    seed: 172,
    label: "All standard dice",
    total: 20,
    modifier: 0,
    appearance: DICE_THEMES.shinji,
    dice: DICE_SHAPES.map((shape, i) => ({
      definition: `d${shape}`,
      shape,
      face: shape - 1,
      value: shape,
      kept: true,
      group: i
    }))
  };
  let seed = 172;
  const physical = simulateDice(
    animation.dice as PresentedDie[],
    () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32
  );
  const replayAnimation = {
    ...animation,
    physics: physical.replay,
    dice: animation.dice.map((die, i) => ({ ...die, face: physical.faces[i], value: physical.faces[i] + 1 }))
  };
  const duration = (physical.replay.frames.length - 1) * physical.replay.stepMs;
  // Advance only the animation clock: screenshot/rendering time on a slow CI
  // runner must not consume the settled-dice interval we are measuring.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.evaluate(
    (animation) => window.dispatchEvent(new CustomEvent("devils-dice-roll", { detail: animation })),
    replayAnimation
  );
  await expect(canvas).toBeVisible();
  await page.clock.fastForward(400);
  await page.screenshot({ path: testInfo.outputPath("dice-bounce-start.png") });
  await page.clock.fastForward(800);
  await page.screenshot({ path: testInfo.outputPath("dice-bounce-rebound.png") });
  await page.clock.fastForward(Math.max(100, duration - 1200 + 100));
  await page.screenshot({ path: testInfo.outputPath("dice-all-shapes.png") });
  expect(await page.locator(".dice-overlay").evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
  const bounds = await page.locator(".scene-stage .table-media-panel").boundingBox(),
    tray = await page.locator(".dice-overlay").boundingBox();
  expect(tray!.x).toBeCloseTo(bounds!.x, 0);
  expect(tray!.y).toBeCloseTo(bounds!.y, 0);
  expect(tray!.width).toBeCloseTo(bounds!.width, 0);
  expect(tray!.height).toBeCloseTo(Math.min(bounds!.y + bounds!.height, page.viewportSize()!.height) - bounds!.y, 0);
  await page.clock.fastForward(2100);
  await expect(page.locator(".dice-overlay")).toHaveAttribute("data-active", "true");
  await page.clock.fastForward(1700);
  await expect(page.locator(".dice-overlay")).toHaveAttribute("data-active", "false");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(
    (animation) =>
      window.dispatchEvent(
        new CustomEvent("devils-dice-roll", {
          detail: { ...animation, id: "phone", createdAt: Date.now() }
        })
      ),
    replayAnimation
  );
  await page.clock.fastForward(duration + 100);
  await page.screenshot({ path: testInfo.outputPath("dice-phone.png") });
  const phone = await page.locator(".dice-overlay").boundingBox();
  expect(phone!.width).toBeLessThanOrEqual(390);
  expect(phone!.height).toBeGreaterThan(100);
  const composer = await page.locator(".chat-form").boundingBox();
  if (composer) expect(phone!.y + phone!.height).toBeLessThanOrEqual(composer.y + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.clock.resume();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(
    (animation) =>
      window.dispatchEvent(
        new CustomEvent("devils-dice-roll", { detail: { ...animation, id: "reduced", createdAt: Date.now() } })
      ),
    animation
  );
  await expect(page.locator(".dice-caption")).toContainText("All standard dice");
  await page.request.put("/api/me/dice", { data: { ...DEFAULT_DICE_PREFERENCES, enabled: false, theme: "shinji" } });
  await page.goto(`/?room=${roomId}`);
  await expect(page.locator(".table-shell")).toBeVisible();
  await page.evaluate(
    (animation) =>
      window.dispatchEvent(
        new CustomEvent("devils-dice-roll", { detail: { ...animation, id: "off", createdAt: Date.now() } })
      ),
    animation
  );
  await expect(page.locator(".dice-overlay")).toHaveAttribute("data-active", "false");
});

test("roll metadata respects server audiences, custom dice and fresh live delivery", async ({ page, browser }) => {
  const system = await prepareTable(page.request);
  const created = await page.request.post("/api/rooms", { data: { name: "Dice Privacy", system } });
  const roomId = (await created.json()).room.id;
  await page.request.patch(`/api/rooms/${roomId}`, { data: { dice3dEnabled: true, dice3dTheme: "grim" } });
  const invitation = await (
    await page.request.post(`/api/rooms/${roomId}/invitations`, { data: { username: "Dice3DPlayer" } })
  ).json();
  const context = await browser.newContext({ baseURL: new URL(created.url()).origin });
  await context.request.post(`/api/invitations/${invitation.invitation.token}/redeem`, {
    data: { password: "dice-player-password" }
  });
  const player = await context.newPage();
  await player.goto(`/?room=${roomId}`);
  await expect(player.locator(".table-shell")).toBeVisible();
  await player.evaluate(() => {
    (window as any).diceEvents = [];
    window.addEventListener("devils-dice-roll", (e) => (window as any).diceEvents.push((e as CustomEvent).detail));
  });
  expect((await context.request.patch(`/api/rooms/${roomId}`, { data: { dice3dEnabled: false } })).status()).toBe(403);
  expect((await context.request.patch(`/api/rooms/${roomId}`, { data: { dice3dTheme: "digital" } })).status()).toBe(
    403
  );
  expect((await page.request.patch(`/api/rooms/${roomId}`, { data: { dice3dTheme: "unknown" } })).status()).toBe(400);
  const publicRoll = await (
    await page.request.post(`/api/rooms/${roomId}/rolls`, { data: { expression: "d100" } })
  ).json();
  await expect.poll(() => player.evaluate(() => (window as any).diceEvents.length)).toBe(1);
  expect(await player.evaluate(() => (window as any).diceEvents[0].id)).toBe(publicRoll.diceAnimations[0].id);
  expect(publicRoll.diceAnimations[0].physics.frames.length).toBeGreaterThan(20);
  expect(await player.evaluate(() => (window as any).diceEvents[0].physics)).toEqual(
    publicRoll.diceAnimations[0].physics
  );
  expect(publicRoll.roll.physics).toBeUndefined();
  expect(publicRoll.diceAnimations[0].appearance).toEqual(diceAppearance(DEFAULT_DICE_PREFERENCES, "grim"));
  await page.request.post(`/api/rooms/${roomId}/rolls`, { data: { expression: "d20", private: true } });
  await page.request.post(`/api/rooms/${roomId}/rolls`, { data: { expression: "d20", invisible: true } });
  await player.waitForTimeout(250);
  expect(await player.evaluate(() => (window as any).diceEvents.length)).toBe(1);
  const sets = await (await page.request.get(`/api/rooms/${roomId}/tables`)).json();
  const set = sets.sets.find((set: any) => set.id === "system:toybox");
  for (const visibility of ["public", "private", "invisible"]) {
    expect(
      (
        await page.request.post(`/api/rooms/${roomId}/tables/roll`, {
          data: { setId: set.id, tableId: set.tables[0].id, visibility }
        })
      ).ok()
    ).toBe(true);
  }
  await player.waitForTimeout(250);
  expect(await player.evaluate(() => (window as any).diceEvents.length)).toBe(1);
  await page.request.post(`/api/rooms/${roomId}/tables/roll`, {
    data: { setId: set.id, tableId: set.tables[0].id, visibility: "reveal" }
  });
  await expect.poll(() => player.evaluate(() => (window as any).diceEvents.length)).toBeGreaterThan(1);
  const custom = await (
    await context.request.post(`/api/rooms/${roomId}/rolls`, { data: { customDie: "fate", count: 4, private: true } })
  ).json();
  expect(custom.roll.dice).toHaveLength(4);
  expect(custom.roll.dice.every((die: any) => die.definition === "toybox:fate" && [-1, 0, 1].includes(die.value))).toBe(
    true
  );
  expect(
    (await context.request.post(`/api/rooms/${roomId}/rolls`, { data: { customDie: "nonexistent" } })).status()
  ).toBe(400);
  const history = await (await context.request.get(`/api/rooms/${roomId}/messages`)).json();
  expect(history.diceAnimations).toBeUndefined();
  await player.reload();
  await expect(player.locator(".dice-overlay")).toHaveAttribute("data-active", "false");
  await context.close();
});

test("a device without WebGL still completes and displays its roll", async ({ page }) => {
  const system = await prepareTable(page.request);
  const created = await (await page.request.post("/api/rooms", { data: { name: "Dice fallback", system } })).json();
  const roomId = created.room.id;
  await page.request.patch(`/api/rooms/${roomId}`, { data: { dice3dEnabled: true } });
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: any[]) {
      if (type.includes("webgl")) return null;
      return (getContext as any).call(this, type, ...args);
    } as typeof getContext;
  });
  await page.goto(`/?room=${roomId}`);
  await expect(page.locator(".table-shell")).toBeVisible();
  await page.getByRole("button", { name: "Roll dice", exact: true }).click();
  await page.getByRole("button", { name: /^Roll 1d20$/ }).click();
  await expect(page.locator(".dice-caption")).toContainText("1d20");
  await expect(page.locator(".dice-canvas canvas")).toHaveCount(0);
  const history = await (await page.request.get(`/api/rooms/${roomId}/messages`)).json();
  expect(history.messages.some((message: any) => message.body.includes("1d20"))).toBe(true);
});

test("physics feeds chat, checks, creation ledgers, and encounter initiative", async ({ page }) => {
  const system = await prepareTable(page.request);
  const room = await (await page.request.post("/api/rooms", { data: { name: "Physical mechanics", system } })).json();
  const roomId = room.room.id;
  await page.request.patch(`/api/rooms/${roomId}`, { data: { dice3dEnabled: true } });
  const post = async (url: string, data: unknown) => {
    const response = await page.request.post(url, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const chat = await post(`/api/rooms/${roomId}/messages`, { body: "/r 3d6kh2" });
  expect(chat.diceAnimations[0].physics.frames.length).toBeGreaterThan(20);
  const save = await post(`/api/rooms/${roomId}/rolls`, {
    expression: "d20",
    save: { target: 10, label: "Muscle", position: "normal" }
  });
  expect(save.diceAnimations[0].total).toBe(save.roll.total);
  expect(save.diceAnimations[0].physics.frames.length).toBeGreaterThan(20);
  const created = await post(`/api/rooms/${roomId}/characters`, { name: "Physical character" });
  const rolled = await post(`/api/rooms/${roomId}/characters/${created.character.id}/creation/roll`, {
    stepId: "abilities"
  });
  expect(rolled.diceAnimations).toHaveLength(3);
  expect(rolled.character.creation.steps.abilities.runs).toBe(1);
  for (let i = 0; i < 3; i++) {
    expect(rolled.character.creation.steps.abilities.scores[i].total).toBe(rolled.diceAnimations[i].total);
    expect(rolled.diceAnimations[i].physics.frames.length).toBeGreaterThan(20);
  }
  const assignedResponse = await page.request.patch(
    `/api/rooms/${roomId}/characters/${created.character.id}/creation`,
    {
      data: { stepId: "abilities", assign: rolled.diceAnimations.map((animation: any) => animation.total) }
    }
  );
  expect(assignedResponse.ok()).toBe(true);
  const assigned = await assignedResponse.json();
  for (const [i, key] of ["muscleMax", "nerveMax", "knackMax"].entries())
    expect(assigned.character.sheet[key]).toBe(rolled.diceAnimations[i].total);
  const { id, zip } = await bundleSystemRepo(MINIMAL_SYSTEM);
  const installed = await page.request.post("/api/admin/systems", {
    multipart: { bundle: { name: `${id}.devilsystem.zip`, mimeType: "application/zip", buffer: zip } }
  });
  expect(installed.ok()).toBe(true);
  const combatRoom = await post("/api/rooms", { name: "Physical initiative", system: id });
  const combatRoomId = combatRoom.room.id;
  await page.request.patch(`/api/rooms/${combatRoomId}`, { data: { dice3dEnabled: true } });
  const encounter = await post(`/api/rooms/${combatRoomId}/encounters`, { name: "Physics encounter" });
  const initiative = await post(`/api/rooms/${combatRoomId}/encounters/${encounter.encounter.id}/roll-initiative`, {});
  expect(initiative.diceAnimations).toHaveLength(2);
  for (const side of initiative.encounter.sides) {
    const animation = initiative.diceAnimations.find((entry: any) => entry.label === `${side.side} initiative`);
    expect(side.initiative).toBe(animation.total);
    expect(animation.physics.frames.length).toBeGreaterThan(20);
  }
});
