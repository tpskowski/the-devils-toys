import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { type AuthedRequest, roomRole } from "./auth.js";
import { db } from "./db.js";
import { playerPreviewMiddleware } from "./player-preview.js";
import { mayReadWikiFile } from "./wiki-permissions.js";
import { characterRouter } from "./characters.js";
import { mediaRouter } from "./media.js";
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
