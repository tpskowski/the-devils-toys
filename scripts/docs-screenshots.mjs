/**
 * Regenerates the screenshots in `docs/guide/images/`.
 *
 * A throwaway server on its own port and its own data directory is filled with
 * a small table — a room, a GM, two players with characters, a map, a scene, a
 * handout, and a fight in progress — and then driven through the browser as a
 * player sees it. Nothing here touches a real database, and the pictures are
 * the only thing it leaves behind.
 *
 *   node scripts/docs-screenshots.mjs            # write the images
 *   node scripts/docs-screenshots.mjs --text     # print what each page says
 *
 * Run `npm run build` first; this drives the built server and client.
 */
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imageDir = path.join(root, "docs", "guide", "images");
const dataDir = path.join(root, ".tmp-docs-shots");
const textOnly = process.argv.includes("--text");

async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function startServer(port) {
  await rm(dataDir, { recursive: true, force: true });
  const child = spawn(process.execPath, ["server/dist/index.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DEVILS_TABLES_PORT: String(port + 1), DEVILS_TOYS_DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/status`)).ok) return child;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`The server did not start.\n${output}`);
}

/** One signed-in identity, holding its own cookie. */
function session(base) {
  let cookie = "";
  return {
    get cookie() {
      return cookie;
    },
    async call(pathname, init = {}, expected) {
      const json = init.body instanceof FormData ? {} : { "content-type": "application/json" };
      const response = await fetch(`${base}${pathname}`, { ...init, headers: { ...json, cookie, ...init.headers } });
      const set = response.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      if (expected && response.status !== expected)
        throw new Error(`${pathname} → ${response.status} ${await response.text()}`);
      return response.status === 204 ? undefined : await response.json();
    }
  };
}

/**
 * A picture drawn by the browser itself, so the guide's maps and scenes look
 * like something rather than being a coloured rectangle — and so this script
 * needs no image library and no binary fixtures committed beside it.
 */
async function drawing(page, { width, height, background, ink, title, marks = [] }) {
  await page.setViewportSize({ width, height });
  await page.setContent(`
    <style>
      html, body { margin: 0; height: 100%; }
      body {
        background: ${background};
        font-family: Georgia, serif;
        color: ${ink};
        position: relative;
        overflow: hidden;
      }
      .grid { position: absolute; inset: 0; opacity: 0.25;
        background-image: linear-gradient(${ink} 1px, transparent 1px),
                          linear-gradient(90deg, ${ink} 1px, transparent 1px);
        background-size: 48px 48px; }
      h1 { position: absolute; left: 32px; bottom: 24px; margin: 0; font-size: 30px; letter-spacing: 0.06em; }
      .mark { position: absolute; transform: translate(-50%, -50%); text-align: center; font-size: 15px; }
      .mark b { display: block; width: 60px; height: 60px; border: 3px solid ${ink}; border-radius: 50%;
                line-height: 56px; font-size: 24px; margin: 0 auto 6px; }
    </style>
    <div class="grid"></div>
    ${marks
      .map((mark) => `<div class="mark" style="left:${mark.x}%;top:${mark.y}%"><b>${mark.glyph}</b>${mark.label}</div>`)
      .join("")}
    <h1>${title}</h1>
  `);
  return page.screenshot();
}

async function main() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  // The same escape hatch `playwright.config.ts` offers, so a machine with a
  // Chromium already on it does not have to fetch another to redraw a picture.
  const browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHROME_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } : {}
  );
  const shots = [];

  try {
    const gm = session(base);
    const player = session(base);

    await gm.call(
      "/api/setup",
      { method: "POST", body: JSON.stringify({ username: "Sable", password: "guide-password-1" }) },
      201
    );
    const { room } = await gm.call(
      "/api/rooms",
      { method: "POST", body: JSON.stringify({ name: "The Cinder Road", system: "cairn" }) },
      201
    );
    await gm.call(`/api/rooms/${room.id}`, { method: "PATCH", body: JSON.stringify({ musicEnabled: true }) }, 204);

    // The player joins the way a player really does: through an invitation.
    const { invitation } = await gm.call(
      `/api/rooms/${room.id}/invitations`,
      { method: "POST", body: JSON.stringify({ username: "Wren" }) },
      201
    );
    await player.call(`/api/invitations/${invitation.token}/redeem`, {
      method: "POST",
      body: JSON.stringify({ password: "guide-password-2" })
    });

    const canvas = await browser.newPage();
    const mapPng = await drawing(canvas, {
      width: 1200,
      height: 800,
      background: "#e9e2d0",
      ink: "#3d3527",
      title: "THE CINDER ROAD",
      marks: [
        { x: 22, y: 34, glyph: "▲", label: "Ash Barrow" },
        { x: 55, y: 58, glyph: "⌂", label: "Toll House" },
        { x: 79, y: 30, glyph: "☗", label: "The Kiln" }
      ]
    });
    const scenePng = await drawing(canvas, {
      width: 1200,
      height: 800,
      background: "#241c1a",
      ink: "#d9c7a7",
      title: "THE TOLL HOUSE, AFTER DARK",
      marks: [{ x: 50, y: 42, glyph: "✦", label: "a lantern, still burning" }]
    });
    await canvas.close();

    async function upload(pathname, name, bytes, type, extra = {}) {
      const form = new FormData();
      form.append("file", new Blob([bytes], { type }), name);
      for (const [key, value] of Object.entries(extra)) form.append(key, value);
      return gm.call(pathname, { method: "POST", body: form }, 201);
    }

    const map = await upload(`/api/rooms/${room.id}/media`, "cinder-road.png", mapPng, "image/png", { kind: "map" });
    const scene = await upload(`/api/rooms/${room.id}/media`, "toll-house.png", scenePng, "image/png", {
      kind: "scene"
    });
    await gm.call(`/api/rooms/${room.id}/map`, { method: "PATCH", body: JSON.stringify({ mediaId: map.media.id }) });
    await gm.call(`/api/rooms/${room.id}/scene`, {
      method: "PATCH",
      body: JSON.stringify({ mediaId: scene.media.id })
    });

    // A Markdown reference, which is what a handout usually is.
    const handout = new TextEncoder().encode(
      "# The Toll Keeper's Ledger\n\n" +
        "Three names are struck through. The fourth is yours, written in a hand you know.\n\n" +
        "- **Bell, of the Kiln** — paid, in full\n" +
        "- **Ottren the Quiet** — paid, in part\n" +
        "- **Wren** — *owing*\n"
    );
    const ledger = await upload(`/api/rooms/${room.id}/media`, "toll-ledger.md", handout, "text/markdown", {
      kind: "reference"
    });
    await gm.call(`/api/rooms/${room.id}/references/${ledger.media.id}/reveal`, { method: "POST" }, 204);

    // The player's character, filled in enough to be worth looking at.
    const { character } = await player.call(
      `/api/rooms/${room.id}/characters`,
      { method: "POST", body: JSON.stringify({ name: "Wren", sheet: {} }) },
      201
    );
    await player.call(`/api/rooms/${room.id}/characters/${character.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: "Wren",
        sheet: {
          background: "Fungal Forager",
          strCurrent: 9,
          strMax: 11,
          dexCurrent: 13,
          dexMax: 13,
          wilCurrent: 8,
          wilMax: 8,
          hpCurrent: 3,
          hpMax: 4,
          armor: 1,
          gp: 6,
          sp: 4,
          cp: 12,
          notes: "Owes the toll keeper a favour. Will not say what for.",
          inventory: ["Sword (d6)", "Torches (3)", "Rations (2)", "Rope, 50ft", "Tinderbox", "", "", "", "", ""],
          weaponSlot: 0
        }
      })
    });
    await player.call(`/api/rooms/${room.id}/active-character`, {
      method: "PATCH",
      body: JSON.stringify({ characterId: character.id })
    });

    // A second player, so the party list is a party rather than one person.
    const bell = session(base);
    const { invitation: bellInvite } = await gm.call(
      `/api/rooms/${room.id}/invitations`,
      { method: "POST", body: JSON.stringify({ username: "Bell" }) },
      201
    );
    await bell.call(`/api/invitations/${bellInvite.token}/redeem`, {
      method: "POST",
      body: JSON.stringify({ password: "guide-password-3" })
    });
    const { character: bellPc } = await bell.call(
      `/api/rooms/${room.id}/characters`,
      { method: "POST", body: JSON.stringify({ name: "Bell", sheet: {} }) },
      201
    );
    await bell.call(`/api/rooms/${room.id}/characters/${bellPc.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: "Bell",
        sheet: {
          background: "Cursed Fishwife",
          strCurrent: 12,
          strMax: 12,
          dexCurrent: 7,
          dexMax: 9,
          wilCurrent: 14,
          wilMax: 14,
          hpCurrent: 5,
          hpMax: 5,
          armor: 2,
          inventory: ["Boat Hook (d8, bulky)", "Lantern", "Salt, a pouch", "", "", "", "", "", "", ""],
          weaponSlot: 0
        }
      })
    });
    await bell.call(`/api/rooms/${room.id}/active-character`, {
      method: "PATCH",
      body: JSON.stringify({ characterId: bellPc.id })
    });

    // A fight in progress, so the tracker has something in it.
    const { encounter } = await gm.call(
      `/api/rooms/${room.id}/encounters`,
      { method: "POST", body: JSON.stringify({ name: "Toll House Ambush" }) },
      201
    );
    await gm.call(`/api/rooms/${room.id}/encounters/${encounter.id}/combatants`, {
      method: "POST",
      body: JSON.stringify({ kind: "character", characterId: character.id })
    });
    await gm.call(`/api/rooms/${room.id}/encounters/${encounter.id}/combatants`, {
      method: "POST",
      body: JSON.stringify({ kind: "character", characterId: bellPc.id })
    });
    for (const name of ["Root Goblin", "Root Goblin"])
      await gm.call(`/api/rooms/${room.id}/encounters/${encounter.id}/combatants`, {
        method: "POST",
        body: JSON.stringify({ kind: "npc", catalogName: name })
      });
    await gm.call(`/api/rooms/${room.id}/encounters/${encounter.id}/activate`, { method: "POST" });

    // Some chat, so the rail is not empty.
    await gm.call(`/api/rooms/${room.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ body: "The lantern in the toll house is still lit. Nobody answers." })
    });
    await player.call(`/api/rooms/${room.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ body: "I put my hand on the door and listen." })
    });

    // --- Now look at it, as the player ---

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(`${base}/`);
    await page.getByRole("textbox").first().fill("Wren");
    await page.locator('input[type="password"]').fill("guide-password-2");
    await page.getByRole("button", { name: /enter the table/i }).click();
    await page
      .getByRole("button", { name: /The Cinder Road/ })
      .first()
      .click();
    await page.waitForTimeout(1200);

    async function shot(name, target = page) {
      const file = path.join(imageDir, `${name}.png`);
      if (!textOnly) await target.screenshot({ path: file });
      shots.push(name);
      return file;
    }

    /**
     * A cropped view with room to breathe. An element's own screenshot stops
     * exactly at its box, which shaves the underline off a bottom row; this
     * takes the page and cuts a slightly larger rectangle out of it.
     */
    async function crop(name, locator, pad = 12) {
      const owner = locator.page();
      const box = await locator.boundingBox();
      if (!box) return;
      const view = owner.viewportSize();
      const clip = {
        x: Math.max(0, box.x - pad),
        y: Math.max(0, box.y - pad),
        width: Math.min(view.width - Math.max(0, box.x - pad), box.width + pad * 2),
        height: Math.min(view.height - Math.max(0, box.y - pad), box.height + pad * 2)
      };
      if (!textOnly) await owner.screenshot({ path: path.join(imageDir, `${name}.png`), clip });
      shots.push(name);
    }

    async function say(label, locator = page.locator("body")) {
      if (!textOnly) return;
      const text = (await locator.innerText()).replace(/\n{2,}/g, "\n").trim();
      console.log(`\n===== ${label} =====\n${text.slice(0, 2200)}`);
    }

    const stage = page.locator(".scene-stage");
    const tab = (name) => page.getByRole("button", { name: new RegExp(`^${name}`) }).first();

    await say("the table");
    await shot("the-table");
    await crop("tab-strip", page.locator(".table-media-tabs"));
    await crop("combat-tracker", page.locator(".rail-encounter"));
    await shot("chat", page.locator(".chat"));

    // The tab strip's second click, which is how a table with more than one map
    // chooses between them. Worth a picture because nothing else hints at it.
    await tab("Maps").click();
    await page.waitForTimeout(400);
    await say("maps");
    await shot("tab-maps", stage);
    await tab("Maps").click();
    await page.waitForTimeout(400);
    await shot("tab-picker");

    await page.keyboard.press("Escape");
    for (const [name, file] of [
      ["Scenes", "tab-scenes"],
      ["References", "tab-references"],
      ["Group", "tab-group"],
      ["Rules", "tab-rules"]
    ]) {
      if (!(await tab(name).count())) continue;
      await tab(name).click();
      await page.waitForTimeout(700);
      await say(name);
      await shot(file, stage);
    }

    // The dialogs a player reaches from the chat bar and the room header.
    await tab("Scenes").click();
    await page.waitForTimeout(400);

    async function dialog(open, file, label) {
      await open();
      await page.waitForTimeout(800);
      const modal = page.locator(".modal").first();
      await say(label, modal);
      await shot(file, modal);
      // Escape closes most of them; the rest close on the scrim behind, which is
      // what a click outside the panel lands on.
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      const scrim = page.locator(".modal-scrim").first();
      if (await scrim.count()) {
        await scrim.click({ position: { x: 4, y: 4 } });
        await page.waitForTimeout(400);
      }
    }

    await dialog(() => page.getByRole("button", { name: /roll dice/i }).click(), "dice", "dice");
    await dialog(() => page.getByRole("button", { name: /your view/i }).click(), "appearance", "your view");

    // The sheet is taller than a laptop window, so it gets one of its own
    // rather than being cut off halfway down the attributes.
    const tall = await browser.newContext({ viewport: { width: 1440, height: 1500 }, deviceScaleFactor: 2 });
    const sheetPage = await tall.newPage();
    await sheetPage.goto(`${base}/`);
    await sheetPage.getByRole("textbox").first().fill("Wren");
    await sheetPage.locator('input[type="password"]').fill("guide-password-2");
    await sheetPage.getByRole("button", { name: /enter the table/i }).click();
    await sheetPage
      .getByRole("button", { name: /The Cinder Road/ })
      .first()
      .click();
    await sheetPage.waitForTimeout(1200);
    await sheetPage.getByRole("button", { name: /manage characters/i }).click();
    await sheetPage.waitForTimeout(900);
    const sheet = sheetPage.locator(".character-modal");
    await say("sheet", sheet);
    await shot("character-sheet", sheet);
    await crop("inventory", sheetPage.locator(".character-list").first());
    await crop("weapon-selector", sheetPage.locator(".weapon-selector"));
    await tall.close();

    // The phone, which is what a player at the table is usually holding.
    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true
    });
    const small = await phone.newPage();
    await small.goto(`${base}/`);
    await small.getByRole("textbox").first().fill("Wren");
    await small.locator('input[type="password"]').fill("guide-password-2");
    await small.getByRole("button", { name: /enter the table/i }).click();
    // On a phone the left rail is folded away, so the room is entered from the
    // card on the landing page rather than from the rail.
    await small
      .getByRole("button", { name: /^Open The Cinder Road/ })
      .first()
      .click();
    await small.waitForTimeout(1500);
    await say("phone", small.locator("body"));
    if (!textOnly) await small.screenshot({ path: path.join(imageDir, "mobile.png") });
    shots.push("mobile");
    await crop("mobile-tabs", small.locator(".mobile-tabs"));
    await phone.close();

    // And the two screens that come before any of it.
    const stranger = await browser.newContext({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 2 });
    const door = await stranger.newPage();
    await door.goto(`${base}/`);
    await door.waitForTimeout(600);
    await say("sign in", door.locator("body"));
    await crop("sign-in", door.locator(".auth-panel"), 28);

    const { invitation: second } = await gm.call(
      `/api/rooms/${room.id}/invitations`,
      { method: "POST", body: JSON.stringify({ username: "Ottren" }) },
      201
    );
    await door.goto(`${base}/invite/${second.token}`);
    await door.waitForTimeout(600);
    await say("invitation", door.locator("body"));
    await crop("invitation", door.locator(".auth-panel"), 28);
    await stranger.close();

    // --- The same room as the GM who runs it ---

    // A calendar, an NPC the GM wrote, and a weapon the room invented, so the
    // Room Config sections have something in them worth photographing.
    await gm.call(`/api/rooms/${room.id}`, { method: "PATCH", body: JSON.stringify({ calendarEnabled: true }) }, 204);
    await gm.call(`/api/rooms/${room.id}/calendar`, {
      method: "PUT",
      body: JSON.stringify({
        year: 803,
        month: 2,
        day: 11,
        segment: 1,
        segmentsPerDay: 3,
        daysPerWeek: 5,
        daysPerMonth: 25,
        dayNames: ["Ember", "Stone", "River", "Gale", "Star"],
        monthNames: ["Deepfrost", "Thawrise", "Highsun", "Ashfall"],
        segmentNames: ["Dawn", "Noon", "Dusk"],
        events: [
          { id: "market", name: "Market Day", cadence: "weekly", day: 4 },
          { id: "founding", name: "Founding Feast", cadence: "holiday", month: 2, day: 18 }
        ]
      })
    });
    // The room's own weapon first, so the creature below can be armed from the
    // picker rather than by typing — which is the case worth photographing.
    const { lists: cairnLists } = await gm.call(`/api/rooms/${room.id}/items`);
    const { item: hook } = await gm.call(
      `/api/rooms/${room.id}/items`,
      {
        method: "POST",
        body: JSON.stringify({
          listKey: cairnLists[0].key,
          name: "Toll Hook",
          spec: "d8, bulky",
          cost: "12gp",
          detail: "Taken from the toll house wall.",
          category: ""
        })
      },
      201
    );
    const { npc: keeper } = await gm.call(
      `/api/rooms/${room.id}/npcs`,
      { method: "POST", body: JSON.stringify({ name: "The Toll Keeper", notes: "Will not step outside." }) },
      201
    );
    await gm.call(
      `/api/rooms/${room.id}/npcs/${keeper.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: "The Toll Keeper",
          notes: "Will not step outside. Keeps the ledger under the counter.",
          statblock: { hp: 9, armor: 1, str: 13, dex: 8, wil: 15, attacks: hook.label, secondWeapon: "Cudgel (d6)" }
        })
      },
      204
    );

    const table = await browser.newContext({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 2 });
    const master = await table.newPage();
    await master.goto(`${base}/`);
    await master.getByRole("textbox").first().fill("Sable");
    await master.locator('input[type="password"]').fill("guide-password-1");
    await master.getByRole("button", { name: /enter the table/i }).click();
    await master
      .getByRole("button", { name: /^The Cinder Road/ })
      .first()
      .click();
    await master.waitForTimeout(1400);

    async function gmDialog(open, file, label) {
      await open();
      await master.waitForTimeout(900);
      const modal = master.locator(".modal").first();
      await say(label, modal);
      await shot(file, modal);
      await master.keyboard.press("Escape");
      await master.waitForTimeout(300);
      const scrim = master.locator(".modal-scrim").first();
      if (await scrim.count()) {
        await scrim.click({ position: { x: 4, y: 4 } });
        await master.waitForTimeout(400);
      }
    }

    await gmDialog(
      () => master.getByRole("button", { name: /room settings/i }).click(),
      "gm-room-settings",
      "settings"
    );
    await gmDialog(() => master.getByRole("button", { name: /create player/i }).click(), "gm-invite", "invite");
    await gmDialog(() => master.getByRole("button", { name: /^random tables$/i }).click(), "gm-tables", "tables");
    await gmDialog(() => master.getByRole("button", { name: /^bestiary$/i }).click(), "gm-bestiary", "bestiary");

    // The encounter tab, which is the GM's board rather than the player's view.
    await master
      .getByRole("button", { name: /^Encounter/ })
      .first()
      .click();
    await master.waitForTimeout(800);
    await say("encounter", master.locator(".scene-stage"));
    await shot("gm-encounter", master.locator(".scene-stage"));

    // Room Config, section by section.
    await master.goto(`${base}/config`);
    await master.waitForTimeout(900);
    await master
      .getByRole("button", { name: /The Cinder Road/ })
      .first()
      .click();
    await master.waitForTimeout(1200);

    for (const [name, file] of [
      ["Library", "gm-config-library"],
      ["NPCs", "gm-config-npcs"],
      ["Items & weapons", "gm-config-items"],
      ["Calendar", "gm-config-calendar"],
      ["Playlists", "gm-config-playlists"],
      ["Hirelings", "gm-config-hirelings"]
    ]) {
      const entry = master.getByRole("button", { name: new RegExp(`^${name.replace("&", "&")}`) }).first();
      if (!(await entry.count())) continue;
      await entry.click();
      await master.waitForTimeout(900);
      // The NPC editor is worth showing filled in rather than empty.
      if (file === "gm-config-npcs") {
        const pick = master.getByRole("button", { name: /The Toll Keeper/ }).first();
        if (await pick.count()) {
          await pick.click();
          await master.waitForTimeout(700);
        }
      }
      await say(name, master.locator(".room-config-main, main").first());
      await shot(file, master.locator(".room-config-main, main").first());
    }
    await table.close();

    // --- And the same server as the admin who runs it ---

    // A second room nobody has joined, so the Room Config picker shows what
    // reaching every room on the server actually looks like.
    await gm.call(
      "/api/rooms",
      { method: "POST", body: JSON.stringify({ name: "The Kiln", system: "monolith" }) },
      201
    );

    const office = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const desk = await office.newPage();
    await desk.goto(`${base}/`);
    await desk.getByRole("textbox").first().fill("Sable");
    await desk.locator('input[type="password"]').fill("guide-password-1");
    await desk.getByRole("button", { name: /enter the table/i }).click();
    await desk.waitForTimeout(1200);

    await desk.getByRole("button", { name: /Players & characters/ }).click();
    await desk.waitForTimeout(1000);
    await say("management", desk.locator("body"));
    if (!textOnly) await desk.screenshot({ path: path.join(imageDir, "admin-accounts.png") });
    shots.push("admin-accounts");

    await desk.goto(`${base}/config`);
    await desk.waitForTimeout(1200);
    await say("room config picker", desk.locator("body"));
    if (!textOnly) await desk.screenshot({ path: path.join(imageDir, "admin-room-config.png") });
    shots.push("admin-room-config");
    await office.close();

    console.log(`\n${textOnly ? "Read" : "Wrote"} ${shots.length} views: ${shots.join(", ")}`);
  } finally {
    await browser.close();
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
}

await mkdir(imageDir, { recursive: true });
await main();
