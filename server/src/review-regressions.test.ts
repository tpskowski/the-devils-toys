import { createPasswordReset, passwordResetRouter } from "./password-resets.js";
import fs from "node:fs";
import http from "node:http";
import type { Socket } from "node:net";
import { once } from "node:events";
import express from "express";
import cookieParser from "cookie-parser";
import { WebSocket } from "ws";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authMiddleware } from "./auth.js";
import { db, one } from "./db.js";
import { setupRouter } from "./setup-routes.js";
import { sessionRouter } from "./session-routes.js";
import { systemRouter } from "./system-routes.js";
import { invitationRouter } from "./invitations.js";
import { invitationTokenHash } from "./invitation-utils.js";
import { roomAdminRouter } from "./room-admin.js";
import { mapNotationRouter } from "./map-notations.js";
import { attachRealtime, broadcastRoom } from "./realtime.js";
import { installToybox } from "./test-fixture.js";
import { buildSystemBundle, renameSystem, type SystemBundleContent } from "./system-bundles.js";
import { systemContentFor } from "./system-install.js";
import { installedSystemRoot } from "./system-content.js";
import { systemOrThrow, hasSystem } from "./systems.js";
import { systemRow } from "./system-registry.js";
import { characterItemsFor } from "./character-items.js";
import { groupRouter } from "./group.js";
import { tableSetRouter, tablesForSystem } from "./table-sets.js";
import { deleteSystemRow, refreshInstalledSystems } from "./system-registry.js";

installToybox();
let server: http.Server;
let origin: string;
const sockets: WebSocket[] = [];

beforeAll(async () => {
  const app = express();
  app.use(express.json(), cookieParser(), authMiddleware);
  app.use(
    "/api",
    passwordResetRouter,
    setupRouter,
    sessionRouter,
    systemRouter,
    invitationRouter,
    roomAdminRouter,
    groupRouter,
    tableSetRouter,
    mapNotationRouter
  );
  server = http.createServer(app);
  attachRealtime(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  await Promise.all(
    sockets.splice(0).map(async (socket) => {
      if (socket.readyState === WebSocket.CLOSED) return;
      const closed = once(socket, "close");
      socket.terminate();
      await closed;
    })
  );
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  db.close();
});

beforeEach(() => {
  db.exec("DELETE FROM rooms; DELETE FROM accounts; UPDATE systems SET retired = 0;");
  for (const [id, role] of [
    [1, "admin"],
    [2, "player"],
    [3, "player"]
  ] as const) {
    db.prepare(
      "INSERT INTO accounts (id, username, password_hash, account_role, is_admin) VALUES (?, ?, '', ?, ?)"
    ).run(id, `user-${id}`, role, Number(id === 1));
    db.prepare("INSERT INTO sessions (id, account_id, expires_at) VALUES (?, ?, ?)").run(
      `session-${id}`,
      id,
      new Date(Date.now() + 3600_000).toISOString()
    );
  }
  db.exec(`INSERT INTO rooms (id, name, system, theme, created_by, map_notation_enabled)
    VALUES (1, 'Test', 'toybox', 'grim', 1, 1);
    INSERT INTO memberships (room_id, account_id, role) VALUES (1, 1, 'gm'), (1, 2, 'player');
    INSERT INTO media (id, room_id, uploaded_by, kind, category, filename, stored_name, mime_type, size, visible)
    VALUES (1, 1, 1, 'scene', 'map', 'map.png', 'map.png', 'image/png', 1, 0);`);
});

function request(path: string, init: RequestInit = {}, account = 1) {
  return fetch(`${origin}/api${path}`, {
    ...init,
    headers: { cookie: `devils_session=session-${account}`, ...init.headers }
  });
}

function post(path: string, body: unknown = {}, account = 1) {
  return request(
    path,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    account
  );
}

async function connect(account: number, session = `session-${account}`) {
  const socket = new WebSocket(origin.replace("http:", "ws:") + "/ws", {
    headers: { cookie: `devils_session=${session}` }
  });
  sockets.push(socket);
  const events: Record<string, unknown>[] = [];
  socket.on("message", (data) => events.push(JSON.parse(data.toString())));
  await once(socket, "open");
  socket.send(JSON.stringify({ type: "join", roomId: 1 }));
  await vi.waitFor(() => expect(events.some((event) => event.type === "presence")).toBe(true));
  return { socket, events };
}

async function install(content: SystemBundleContent) {
  const form = new FormData();
  form.append("bundle", new Blob([new Uint8Array(buildSystemBundle(content))]), "system.zip");
  return request("/admin/systems", { method: "POST", body: form });
}

describe("review regression scenarios", () => {
  it("closes the logged-out socket without disconnecting another session", async () => {
    const revoked = await connect(1);
    const other = await connect(2);
    const closed = once(revoked.socket, "close");
    expect((await post("/logout")).status).toBe(204);
    expect((await closed)[0]).toBe(4001);
    broadcastRoom(1, { type: "still-signed-in" });
    await vi.waitFor(() => expect(other.events.some((event) => event.type === "still-signed-in")).toBe(true));
  });

  it.each(["expired", "deleted"])("blocks incoming and outgoing traffic for %s sessions", async (mode) => {
    const revoked = await connect(2);
    const other = await connect(1);
    if (mode === "expired")
      db.exec("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = 'session-2'");
    else db.exec("DELETE FROM sessions WHERE id = 'session-2'");
    const closed = once(revoked.socket, "close");
    if (mode === "expired") revoked.socket.send(JSON.stringify({ type: "scene-ping", x: 0.2, y: 0.3 }));
    else broadcastRoom(1, { type: "private-after-revocation" });
    expect((await closed)[0]).toBe(4001);
    broadcastRoom(1, { type: "session-check-finished" });
    await vi.waitFor(() => expect(other.events.some((event) => event.type === "session-check-finished")).toBe(true));
    expect(other.events.some((event) => event.type === "scene-ping")).toBe(false);
    expect(revoked.events.some((event) => event.type === "private-after-revocation")).toBe(false);
  });

  it("uses group revisions independently of audio and rejects repeated revisions", async () => {
    const initial = await (await request("/rooms/1/group")).json();
    expect(initial.revision).toBe(0);
    db.exec(`INSERT INTO room_state (room_id, audio_json, updated_at) VALUES (1, '{"playing":true}', '2099-01-01')`);
    const save = (revision: number, notes: string) =>
      request("/rooms/1/group", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: { notes }, revision })
      });
    const first = await save(0, "first");
    expect(first.status).toBe(200);
    expect((await first.json()).revision).toBe(1);
    expect((await save(0, "stale")).status).toBe(409);
    db.exec("UPDATE room_state SET updated_at = '2099-02-01' WHERE room_id = 1");
    const second = await save(1, "second");
    expect(second.status).toBe(200);
    expect((await second.json()).revision).toBe(2);
    expect(one("SELECT group_json, audio_json FROM room_state WHERE room_id = 1")).toEqual({
      group_json: '{"notes":"second"}',
      audio_json: '{"playing":true}'
    });
  });

  it("requires the initial revision for a first group save and refuses obsolete timestamp guards", async () => {
    const save = (guard: object) =>
      request("/rooms/1/group", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: { notes: "first" }, ...guard })
      });
    expect((await save({ revision: 3 })).status).toBe(409);
    expect((await save({ updatedAt: null })).status).toBe(409);
    expect(one("SELECT room_id FROM room_state WHERE room_id = 1")).toBeUndefined();
    const saved = await save({ revision: 0 });
    expect(saved.status).toBe(200);
    expect((await saved.json()).revision).toBe(1);
  });

  it("refreshes a cached table set after another process removes its system", async () => {
    const content = renameSystem(systemContentFor("toybox"), "removed-system", "Removed system");
    expect((await install(content)).status).toBe(201);
    refreshInstalledSystems();
    expect(tablesForSystem("removed-system").length).toBeGreaterThan(0);
    // Simulate the other process: do not call this process's unloadSystem.
    deleteSystemRow("removed-system");
    fs.rmSync(installedSystemRoot("removed-system"), { recursive: true });
    const detail = await request("/table-sets/system:removed-system");
    expect(detail.status).toBe(404);
    expect(hasSystem("removed-system")).toBe(false);
    expect(() => tablesForSystem("removed-system")).toThrow();
    const listing = await (await request("/table-sets")).json();
    expect(JSON.stringify(listing)).not.toContain("removed-system");
  });
  it("allows only one initial administrator when setup requests overlap", async () => {
    db.exec("DELETE FROM rooms; DELETE FROM accounts;");
    const results = await Promise.all(
      ["first-owner", "second-owner"].map((username) => post("/setup", { username, password: "test-password-long" }))
    );
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(one<{ count: number }>("SELECT COUNT(*) AS count FROM accounts WHERE is_admin = 1")!.count).toBe(1);
  });

  it("closes a malformed WebSocket without losing other clients or HTTP service", async () => {
    const bad = await connect(1);
    const good = await connect(2);
    const closed = once(bad.socket, "close");
    // Client-to-server frames must be masked. Exercise ws's decoder, not JSON parsing.
    (bad.socket as WebSocket & { _socket: Socket })._socket.write(Buffer.from([0x81, 0x01, 0x61]));
    await closed;
    expect((await request("/status")).status).toBe(200);
    broadcastRoom(1, { type: "test-alive" });
    await vi.waitFor(() => expect(good.events.some((event) => event.type === "test-alive")).toBe(true));
  });

  it.each([false, true])("filters all annotation mutations when map visibility is %s", async (visible) => {
    db.prepare("UPDATE media SET visible = ? WHERE id = 1").run(Number(visible));
    const gm = await connect(1);
    const player = await connect(2);
    expect((await request("/rooms/1/maps/1/notations", {}, 2)).status).toBe(visible ? 200 : 404);
    const path = "/rooms/1/maps/1/notations";
    const label = { kind: "label", color: "#f5f5f5", x: 0.5, y: 0.5, text: "Secret treasure", fontSize: 16 };
    const created = await post(path, label);
    expect(created.status).toBe(201);
    const { notation } = await created.json();
    expect((await request(`${path}/${notation.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await post(path, label)).status).toBe(201);
    expect((await post(`${path}/undo`)).status).toBe(200);
    expect((await post(path, label)).status).toBe(201);
    expect((await request(path, { method: "DELETE" })).status).toBe(204);
    // A marker on each socket proves all earlier broadcasts have been consumed.
    broadcastRoom(1, { type: "test-finished" });
    await vi.waitFor(() => expect(player.events.some((event) => event.type === "test-finished")).toBe(true));
    await vi.waitFor(() => expect(gm.events.some((event) => event.type === "test-finished")).toBe(true));
    const annotations = (events: Record<string, unknown>[]) =>
      events.filter((event) => String(event.type).startsWith("map-notation"));
    expect(annotations(gm.events)).toHaveLength(6);
    expect(annotations(player.events)).toHaveLength(visible ? 6 : 0);
  });

  it("keeps retired-system room metadata while removing its new-room choice", async () => {
    expect((await post("/admin/systems/toybox/retire")).status).toBe(200);
    const status = await (await request("/status")).json();
    expect(status.systems.some((system: { id: string }) => system.id === "toybox")).toBe(false);
    expect(status.roomSystems.find((system: { id: string }) => system.id === "toybox")).toMatchObject({
      traits: expect.any(Array),
      dice: expect.any(Object),
      groupPage: true
    });
    expect(one("SELECT id FROM rooms WHERE id = 1")).toBeDefined();
  });

  it("restores files, registration and cached content after a failed replacement", async () => {
    const before = systemContentFor("toybox");
    const row = systemRow("toybox");
    const items = characterItemsFor("toybox");
    const replacement = structuredClone(before);
    replacement.system.name = "Rejected replacement";
    db.exec(
      "CREATE TRIGGER fail_system_update BEFORE UPDATE ON systems BEGIN SELECT RAISE(FAIL, 'test write failure'); END;"
    );
    try {
      expect((await install(replacement)).status).toBe(400);
    } finally {
      db.exec("DROP TRIGGER fail_system_update;");
    }
    expect(systemRow("toybox")).toEqual(row);
    expect(systemOrThrow("toybox").name).toBe(before.system.name);
    expect(systemContentFor("toybox")).toEqual(before);
    expect(characterItemsFor("toybox")).toEqual(items);
    expect(fs.existsSync(`${installedSystemRoot("toybox")}.replaced`)).toBe(false);
  });

  it("removes new files if a first installation cannot be registered", async () => {
    const content = renameSystem(systemContentFor("toybox"), "rejected-system");
    db.exec(
      "CREATE TRIGGER fail_system_insert BEFORE INSERT ON systems BEGIN SELECT RAISE(FAIL, 'test insert failure'); END;"
    );
    try {
      expect((await install(content)).status).toBe(400);
    } finally {
      db.exec("DROP TRIGGER fail_system_insert;");
    }
    expect(systemRow(content.system.id)).toBeUndefined();
    expect(hasSystem(content.system.id)).toBe(false);
    expect(fs.existsSync(installedSystemRoot(content.system.id))).toBe(false);
  });

  it("restores the old in-memory definition if committing after loading fails", async () => {
    const before = systemContentFor("toybox");
    const row = systemRow("toybox");
    const replacement = structuredClone(before);
    replacement.system.name = "Uncommitted replacement";
    const exec = db.exec.bind(db);
    const failure = vi.spyOn(db, "exec").mockImplementation((sql) => {
      if (sql === "COMMIT") throw new Error("test commit failure");
      return exec(sql);
    });
    try {
      expect((await install(replacement)).status).toBe(400);
    } finally {
      failure.mockRestore();
    }
    expect(systemRow("toybox")).toEqual(row);
    expect(systemOrThrow("toybox").name).toBe(before.system.name);
    expect(systemContentFor("toybox")).toEqual(before);
  });

  it("keeps the installation error primary while retrying a failed database rollback", async () => {
    const before = systemContentFor("toybox");
    const exec = db.exec.bind(db);
    let rollbackAttempts = 0;
    const failure = vi.spyOn(db, "exec").mockImplementation((sql) => {
      if (sql === "COMMIT") throw new Error("test commit failure");
      if (sql === "ROLLBACK" && rollbackAttempts++ === 0) throw new Error("test rollback failure");
      return exec(sql);
    });
    let response: Response;
    try {
      response = await install(before);
    } finally {
      failure.mockRestore();
    }
    const body = await response!.json();
    expect(response!.status).toBe(400);
    expect(body.error).toMatch(/test commit failure.*test rollback failure/i);
    expect(rollbackAttempts).toBe(2);
    expect(db.isTransaction).toBe(false);
    expect(systemContentFor("toybox")).toEqual(before);
  });

  it("rejects incomplete tables before replacing installed content", async () => {
    const before = systemContentFor("toybox");
    const malformed = structuredClone(before);
    const file = Object.keys(malformed.tables)[0];
    const document = JSON.parse(malformed.tables[file]);
    delete document.tables[0].tags;
    malformed.tables[file] = JSON.stringify(document);
    expect((await install(malformed)).status).toBe(400);
    expect(systemContentFor("toybox")).toEqual(before);
  });

  it("rejects expired ISO sessions while accepting unexpired sessions", async () => {
    db.prepare("UPDATE sessions SET expires_at = ? WHERE id = 'session-2'").run(new Date(Date.now() - 1).toISOString());
    expect((await request("/me", {}, 2)).status).toBe(401);
    expect((await request("/me", {}, 1)).status).toBe(200);
  });

  it("rejects expired invitations and makes the account available to add again", async () => {
    db.prepare("INSERT INTO invitations (token_hash, room_id, account_id, expires_at) VALUES (?, 1, 3, ?)").run(
      invitationTokenHash("expired"),
      new Date(Date.now() - 1).toISOString()
    );
    expect((await post("/invitations/expired/redeem", { password: "test-password-long" })).status).toBe(410);
    const options = await (await request("/rooms/1/member-options")).json();
    expect(options.accounts.some((account: { id: number }) => account.id === 3)).toBe(true);
    expect(one("SELECT account_id FROM memberships WHERE account_id = 3")).toBeUndefined();
  });
});

describe("password reset review regressions", () => {
  it.each([true, false])("closes only the visiting session's sockets when opening a link (valid=%s)", async (valid) => {
    db.prepare("INSERT INTO sessions (id, account_id, expires_at) VALUES ('other-device', 1, ?)").run(
      new Date(Date.now() + 3600000).toISOString()
    );
    const firstTab = await connect(1);
    const secondTab = await connect(1);
    const otherDevice = await connect(1, "other-device");
    const closures = [once(firstTab.socket, "close"), once(secondTab.socket, "close")];
    const { token } = createPasswordReset(3);
    expect((await post("/password-reset/open", { token: valid ? token : "invalid" }, 1)).status).toBe(
      valid ? 200 : 400
    );
    for (const closed of await Promise.all(closures)) expect(closed[0]).toBe(4001);
    expect(one("SELECT id FROM sessions WHERE id = 'session-1'")).toBeUndefined();
    expect(one("SELECT id FROM sessions WHERE id = 'other-device'")).toBeDefined();
    broadcastRoom(1, { type: "review-probe" });
    await vi.waitFor(() => expect(otherDevice.events.some((event) => event.type === "review-probe")).toBe(true));
    expect(firstTab.events.some((event) => event.type === "review-probe")).toBe(false);
    expect(secondTab.events.some((event) => event.type === "review-probe")).toBe(false);
    expect(otherDevice.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("revokes an older pending invitation only after a successful password reset", async () => {
    db.prepare("INSERT INTO invitations (token_hash, room_id, account_id, expires_at) VALUES (?, 1, 3, ?)").run(
      invitationTokenHash("old-invite"),
      new Date(Date.now() + 3600000).toISOString()
    );
    const { token } = createPasswordReset(3);
    expect((await post("/password-reset", { token, password: "short" })).status).toBe(400);
    expect(
      one<{ revoked_at: string | null }>("SELECT revoked_at FROM invitations WHERE account_id = 3")!.revoked_at
    ).toBeNull();
    expect((await post("/password-reset", { token, password: "reset-password-chosen" })).status).toBe(204);
    expect((await post("/invitations/old-invite/redeem", { password: "old-invite-takeover" })).status).toBe(410);
    expect((await post("/login", { username: "user-3", password: "reset-password-chosen" })).status).toBe(200);
    expect((await post("/login", { username: "user-3", password: "old-invite-takeover" })).status).toBe(401);
  });
});
