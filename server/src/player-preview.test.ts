import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { type AuthedRequest, roomRole } from "./auth.js";
import { db } from "./db.js";
import { playerPreviewMiddleware } from "./player-preview.js";
import { mayReadWikiFile } from "./wiki-permissions.js";
import { characterRouter } from "./characters.js";
import { mediaRouter } from "./media.js";
import { audioRouter } from "./audio.js";
import { groupRouter } from "./group.js";
import { config } from "./config.js";
import { imageVersion } from "./image-cache.js";
import { installToybox } from "./test-fixture.js";

installToybox();
let server: http.Server;
let origin: string;
beforeAll(async () => {
  const app = express();
  app.use((req: AuthedRequest, _res, next) => {
    const id = Number(req.header("x-account") ?? 1);
    req.account = { id, username: `User ${id}`, role: id === 1 ? "gm" : "player", isAdmin: false };
    next();
  });
  app.use(playerPreviewMiddleware);
  app.use("/api", characterRouter);
  app.use("/api", mediaRouter);
  app.use("/api", audioRouter);
  app.use("/api", groupRouter);
  app.get("/api/rooms/:roomId", async (req: AuthedRequest, res) => {
    await Promise.resolve();
    res.json({
      account: req.account,
      role: roomRole(req.account!.id, Number(req.params.roomId)),
      privateNote: mayReadWikiFile(req.account!, { room_id: 1, owner_account_id: 2, visible: 0 }),
      sharedNote: mayReadWikiFile(req.account!, { room_id: 1, owner_account_id: 2, visible: 1 }),
      url: "/api/media/1/file?v=version"
    });
  });
  app.post("/api/rooms/:roomId", (_req, res) => res.json({ wrote: true }));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  db.exec(
    "DELETE FROM characters; DELETE FROM media; DELETE FROM memberships; DELETE FROM rooms; DELETE FROM accounts;"
  );
  for (const id of [1, 2, 3])
    db.prepare("INSERT INTO accounts (id, username, password_hash, account_role) VALUES (?, ?, '', ?)").run(
      id,
      `User ${id}`,
      id === 1 ? "gm" : "player"
    );
  db.prepare(
    "INSERT INTO rooms (id, name, system, theme, created_by, wiki_enabled) VALUES (1, 'Table', 'toybox', 'grim', 1, 1)"
  ).run();
  for (const id of [1, 2])
    db.prepare("INSERT INTO memberships (room_id, account_id, role) VALUES (1, ?, ?)").run(
      id,
      id === 1 ? "gm" : "player"
    );
  db.prepare("INSERT INTO characters (id, system, owner_account_id, name) VALUES (1, 'toybox', 2, 'Personal')").run();
  db.prepare("INSERT INTO characters (id, system, pool_room_id, name) VALUES (2, 'toybox', 1, 'Shared')").run();
});
const preview = (player: string, path = "/rooms/1", init?: RequestInit) =>
  fetch(`${origin}/api/player-preview/1/${player}${path}`, init);

it("uses the selected player's identity and leaves concurrent GM requests alone", async () => {
  const [selected, generic, gm] = await Promise.all([
    preview("2").then((r) => r.json()),
    preview("generic").then((r) => r.json()),
    fetch(`${origin}/api/rooms/1`).then((r) => r.json())
  ]);
  expect(selected).toMatchObject({
    account: { id: 2, role: "player", isAdmin: false },
    role: "player",
    privateNote: true,
    sharedNote: true
  });
  expect(generic).toMatchObject({ account: { id: -1 }, role: "player", privateNote: false, sharedNote: true });
  expect(gm.role).toBe("gm");
  expect(roomRole(1, 1)).toBe("gm");
});

it("shows personal characters only in that player's preview", async () => {
  const selected = await (await preview("2", "/rooms/1/characters")).json();
  const generic = await (await preview("generic", "/rooms/1/characters")).json();
  expect(selected.characters.map((c: { name: string }) => c.name)).toContain("Personal");
  expect(generic.characters.map((c: { name: string }) => c.name)).toEqual(["Shared"]);
  expect(generic.activeCharacterId).toBeNull();
});

it("refuses writes, other rooms, global account access, non-GMs and invalid players", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"])
    expect((await preview("2", "/rooms/1", { method })).status).toBe(403);
  expect((await preview("2", "/rooms/2")).status).toBe(403);
  expect((await preview("2", "/accounts")).status).toBe(403);
  expect((await preview("2", "/rooms/1", { headers: { "x-account": "2" } })).status).toBe(403);
  expect((await preview("1")).status).toBe(404);
  expect((await preview("3")).status).toBe(404);
});

it("rechecks membership on every request", async () => {
  expect((await preview("2")).ok).toBe(true);
  db.prepare("DELETE FROM memberships WHERE account_id = 2").run();
  expect((await preview("2")).status).toBe(404);
  db.prepare("UPDATE memberships SET role = 'player' WHERE account_id = 1").run();
  expect((await preview("generic")).status).toBe(403);
});

it("scopes media URLs and applies real media visibility checks", async () => {
  const response = await preview("generic");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect((await response.json()).url).toBe("/api/player-preview/1/generic/media/1/file?v=version");
  db.prepare(
    `INSERT INTO media (id, room_id, uploaded_by, kind, category, filename, stored_name, mime_type, size, visible)
    VALUES (1, 1, 1, 'scene', 'scene', 'hidden.png', 'hidden.png', 'image/png', 10, 0)`
  ).run();
  expect((await preview("generic", "/media/1/file")).status).toBe(404);
  expect((await preview("2", "/media/1/thumbnail")).status).toBe(404);
});

it("reads legacy audio without persisting metadata during either kind of preview", async () => {
  db.prepare("UPDATE rooms SET music_enabled = 1 WHERE id = 1").run();
  db.prepare(
    `INSERT INTO media (id, room_id, uploaded_by, kind, category, filename, stored_name, mime_type, size, visible, metadata_loaded)
     VALUES (1, 1, 1, 'audio', 'audio', 'legacy.mp3', 'missing.mp3', 'audio/mpeg', 10, 1, 0)`
  ).run();
  const before = db.prepare("SELECT * FROM media WHERE id = 1").get();
  for (const player of ["generic", "2"]) {
    const response = await preview(player, "/rooms/1/audio");
    expect(response.ok).toBe(true);
    expect((await response.json()).tracks).toHaveLength(1);
    expect(db.prepare("SELECT * FROM media WHERE id = 1").get()).toEqual(before);
  }
  // Ordinary reads still backfill legacy metadata.
  expect((await fetch(`${origin}/api/rooms/1/audio`)).ok).toBe(true);
  expect(db.prepare("SELECT metadata_loaded FROM media WHERE id = 1").get()).toEqual({ metadata_loaded: 1 });
});

it("shares versioned image and thumbnail cache URLs after checking each simulated player's access", async () => {
  const storedName = "preview-cache.png";
  const pixels = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } })
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(config.dataDir, "uploads", storedName), pixels);
  db.prepare(
    `INSERT INTO media (id, room_id, uploaded_by, kind, category, filename, stored_name, mime_type, size, visible)
     VALUES (1, 1, 1, 'scene', 'scene', ?, ?, 'image/png', ?, 1)`
  ).run(storedName, storedName, pixels.length);
  for (const kind of ["file", "thumbnail"]) {
    const imagePath = `/media/1/${kind}?v=${imageVersion(storedName)}`;
    const canonical = await fetch(`${origin}/api${imagePath}`);
    expect(canonical.status).toBe(200);
    expect(canonical.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    const bytes = await canonical.arrayBuffer();
    for (const player of ["generic", "2"]) {
      const redirect = await preview(player, imagePath, { redirect: "manual" });
      expect(redirect.status).toBe(307);
      expect(redirect.headers.get("location")).toBe(`/api${imagePath}`);
      expect(redirect.headers.get("cache-control")).toBe("private, no-store");
      const followed = await preview(player, imagePath);
      expect(followed.url).toBe(canonical.url);
      expect(await followed.arrayBuffer()).toEqual(bytes);
    }
    expect((await preview("2", `/media/1/${kind}?v=outdated`, { redirect: "manual" })).status).toBe(404);
  }
  // Previously loading the GM's cached image must not bypass preview visibility.
  db.prepare("UPDATE media SET visible = 0 WHERE id = 1").run();
  for (const player of ["generic", "2"])
    for (const kind of ["file", "thumbnail"]) {
      const denied = await preview(player, `/media/1/${kind}?v=${imageVersion(storedName)}`, { redirect: "manual" });
      expect(denied.status).toBe(404);
      expect(denied.headers.get("location")).toBeNull();
    }
});

it("keeps unversioned images uncached and does not redirect documents", async () => {
  fs.writeFileSync(path.join(config.dataDir, "uploads", "preview-note.md"), "Shared note");
  db.prepare(
    `INSERT INTO media (id, room_id, uploaded_by, kind, category, filename, stored_name, mime_type, size, visible)
     VALUES (1, 1, 1, 'reference', 'reference', 'note.md', 'preview-note.md', 'text/markdown', 11, 1)`
  ).run();
  const document = await preview("2", "/media/1/file?v=anything", { redirect: "manual" });
  expect(document.status).toBe(200);
  expect(document.headers.get("cache-control")).toBe("private, no-store");
  expect(document.headers.get("location")).toBeNull();
  db.prepare("UPDATE media SET mime_type = 'image/png' WHERE id = 1").run();
  const unversioned = await preview("2", "/media/1/file", { redirect: "manual" });
  expect(unversioned.status).toBe(200);
  expect(unversioned.headers.get("cache-control")).toBe("private, no-store");
  expect(unversioned.headers.get("location")).toBeNull();
});

it("shares portrait cache URLs only after the selected player's character and group checks", async () => {
  db.prepare(
    "UPDATE characters SET portrait_stored_name = 'personal.png', portrait_mime_type = 'image/png' WHERE id = 1"
  ).run();
  const portrait = "/rooms/1/characters/1/portrait?v=personal.png";
  const selected = await preview("2", portrait, { redirect: "manual" });
  expect(selected.status).toBe(307);
  expect(selected.headers.get("location")).toBe(`/api${portrait}`);
  expect(selected.headers.get("cache-control")).toBe("private, no-store");
  expect((await preview("generic", portrait, { redirect: "manual" })).status).toBe(404);
  db.prepare(
    "INSERT INTO group_hirelings (id, room_id, name, portrait_stored_name, portrait_mime_type) VALUES (1, 1, 'Guide', 'guide.png', 'image/png')"
  ).run();
  const groupImage = "/rooms/1/group/hirelings/1/image?v=guide.png";
  for (const player of ["generic", "2"]) {
    const response = await preview(player, groupImage, { redirect: "manual" });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`/api${groupImage}`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
});
