import http from "node:http";
import { once } from "node:events";
import { WebSocket } from "ws";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db.js";
import { logger } from "./logger.js";
import { attachRealtime, broadcastRoom, disconnectSession, roomMembers } from "./realtime.js";
import { installToybox } from "./test-fixture.js";

installToybox();
let server: http.Server;
let origin: string;
const sockets: WebSocket[] = [];
type Event = { type: string; message?: { body: string }; members?: { accountId: number; online: boolean }[] };

beforeEach(async () => {
  db.exec("DELETE FROM rooms; DELETE FROM accounts;");
  for (const id of [1, 2, 3]) {
    db.prepare("INSERT INTO accounts (id, username, password_hash, account_role) VALUES (?, ?, '', ?)").run(
      id,
      `user-${id}`,
      id === 1 ? "gm" : "player"
    );
    db.prepare("INSERT INTO sessions (id, account_id, expires_at) VALUES (?, ?, ?)").run(
      `session-${id}`,
      id,
      new Date(Date.now() + 3600_000).toISOString()
    );
  }
  db.exec(`INSERT INTO rooms (id, name, system, theme, created_by) VALUES
    (1, 'First room', 'toybox', 'grim', 1), (2, 'Second room', 'toybox', 'grim', 1);
    INSERT INTO memberships (room_id, account_id, role) VALUES
    (1, 1, 'gm'), (1, 2, 'player'), (1, 3, 'player'), (2, 1, 'gm'), (2, 2, 'player');`);
  vi.spyOn(logger, "info").mockImplementation(() => {});
  vi.spyOn(logger, "warn").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
  server = http.createServer();
  attachRealtime(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `ws://127.0.0.1:${(server.address() as { port: number }).port}/ws`;
});

afterEach(async () => {
  try {
    await Promise.all(sockets.splice(0).map(close));
    // A client's close event can precede its server-side close callback.
    await vi.waitFor(() =>
      expect(closedLogs()).toHaveLength(
        vi.mocked(logger.info).mock.calls.filter(([message]) => message === "WebSocket connected").length
      )
    );
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    // Neither heartbeat nor delayed departure callbacks may survive the server.
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
});
afterAll(() => db.close());

function closedLogs() {
  return [...vi.mocked(logger.info).mock.calls, ...vi.mocked(logger.warn).mock.calls].filter(
    ([message]) => message === "WebSocket closed"
  );
}

async function close(socket: WebSocket) {
  if (socket.readyState === WebSocket.CLOSED) return;
  const previousCount = closedLogs().length;
  const closed = once(socket, "close");
  socket.close(1000);
  await closed;
  await vi.waitFor(() => expect(closedLogs().length).toBeGreaterThan(previousCount));
}

async function connect(accountId: number, options: { autoPong?: boolean; watch?: boolean; roomId?: number } = {}) {
  const socket = new WebSocket(origin, {
    headers: { cookie: `devils_session=session-${accountId}` },
    autoPong: options.autoPong ?? true
  });
  sockets.push(socket);
  const events: Event[] = [];
  socket.on("message", (raw) => events.push(JSON.parse(raw.toString())));
  await once(socket, "open");
  socket.send(JSON.stringify({ type: options.watch ? "watch" : "join", roomId: options.roomId ?? 1 }));
  if (options.watch) {
    await vi.waitFor(() =>
      expect(logger.info).toHaveBeenCalledWith("WebSocket watching room", expect.objectContaining({ accountId }))
    );
  } else {
    await vi.waitFor(() => expect(events.some((event) => event.type === "presence")).toBe(true));
  }
  return { socket, events };
}

// A marker proves earlier messages reached the viewer before asserting absence.
async function flush(viewer: { events: Event[] }, roomId = 1) {
  viewer.events.splice(0, viewer.events.length, ...viewer.events.filter((event) => event.type !== "test-marker"));
  broadcastRoom(roomId, { type: "test-marker" });
  await vi.waitFor(() => expect(viewer.events.some((event) => event.type === "test-marker")).toBe(true));
}
const notices = (viewer: { events: Event[] }) =>
  viewer.events.filter((event) => event.type === "presence-notice").map((event) => event.message!.body);

describe("WebSocket liveness and presence notices", () => {
  it("suppresses a brief reconnect while updating live presence and logging the gap", async () => {
    const gm = await connect(1);
    const player = await connect(2);
    await flush(gm);
    expect(notices(gm)).toEqual(["user-2 joined the room."]);
    gm.events.length = 0;
    await close(player.socket);
    await vi.waitFor(() => expect(roomMembers(1).find((member) => member.accountId === 2)?.online).toBe(false));
    await vi.advanceTimersByTimeAsync(1500);
    await connect(2);
    await vi.advanceTimersByTimeAsync(10_000);
    await flush(gm);
    expect(notices(gm)).toEqual([]);
    expect(roomMembers(1).find((member) => member.accountId === 2)?.online).toBe(true);
    const closed = vi
      .mocked(logger.info)
      .mock.calls.find(
        ([message, data]) => message === "WebSocket closed" && (data as { accountId: number }).accountId === 2
      )![1] as { connectionId: string };
    expect(logger.info).toHaveBeenCalledWith(
      "WebSocket reconnected to room",
      expect.objectContaining({
        accountId: 2,
        roomId: 1,
        previousConnectionId: closed.connectionId,
        reconnectGapMs: expect.any(Number)
      })
    );
  });

  it("announces one departure after the grace period and a later fresh join, to GMs only", async () => {
    const gm = await connect(1);
    const player = await connect(2);
    const observer = await connect(3);
    await flush(gm);
    gm.events.length = 0;
    await close(player.socket);
    await flush(gm);
    expect(notices(gm)).toEqual([]);
    await vi.advanceTimersByTimeAsync(10_000);
    await flush(gm);
    expect(notices(gm)).toEqual(["user-2 left the room."]);
    await connect(2);
    await flush(gm);
    await flush(observer);
    expect(notices(gm)).toEqual(["user-2 left the room.", "user-2 joined the room."]);
    expect(notices(observer)).toEqual([]);
  });

  it("keeps multi-tab presence until the last tab leaves", async () => {
    const gm = await connect(1);
    const first = await connect(2);
    const second = await connect(2);
    await flush(gm);
    expect(notices(gm)).toEqual(["user-2 joined the room."]);
    gm.events.length = 0;
    await close(first.socket);
    await vi.advanceTimersByTimeAsync(10_000);
    await flush(gm);
    expect(notices(gm)).toEqual([]);
    expect(roomMembers(1).find((member) => member.accountId === 2)?.online).toBe(true);
    await close(second.socket);
    await vi.advanceTimersByTimeAsync(10_000);
    await flush(gm);
    expect(notices(gm)).toEqual(["user-2 left the room."]);
  });

  it("delays departure when the browser closes its socket to switch rooms", async () => {
    const firstGm = await connect(1);
    const secondGm = await connect(1, { roomId: 2 });
    const player = await connect(2);
    await flush(firstGm);
    firstGm.events.length = 0;
    // The browser tears down the old room's socket and opens a new one.
    await close(player.socket);
    await connect(2, { roomId: 2 });
    await flush(firstGm);
    await flush(secondGm, 2);
    expect(notices(firstGm)).toEqual([]);
    expect(notices(secondGm)).toEqual(["user-2 joined the room."]);
    expect(roomMembers(1).find((member) => member.accountId === 2)?.online).toBe(false);
    expect(roomMembers(2).find((member) => member.accountId === 2)?.online).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    await flush(firstGm);
    await flush(secondGm, 2);
    expect(notices(firstGm)).toEqual(["user-2 left the room."]);
    expect(notices(secondGm)).toEqual(["user-2 joined the room."]);
  });

  it("keeps protocol room switches on the same socket immediate and excludes configuration watchers", async () => {
    const gm = await connect(1);
    const watcher = await connect(1, { watch: true });
    const player = await connect(2);
    await flush(gm);
    gm.events.length = 0;
    player.socket.send(JSON.stringify({ type: "join", roomId: 2 }));
    await vi.waitFor(() => expect(notices(gm)).toEqual(["user-2 left the room."]));
    expect(notices(watcher)).toEqual([]);
    await close(watcher.socket);
    await vi.advanceTimersByTimeAsync(10_000);
    await flush(gm);
    expect(notices(gm)).toEqual(["user-2 left the room."]);
  });

  it("pings idle sockets repeatedly and retains clients that answer", async () => {
    const player = await connect(2);
    for (let count = 0; count < 3; count++) {
      const ping = once(player.socket, "ping");
      await vi.advanceTimersByTimeAsync(25_000);
      await ping;
      // Wait for the reply to be processed by the real socket before time jumps.
      player.socket.send(JSON.stringify({ type: "scene-ping", x: 0.5, y: 0.5 }));
      await vi.waitFor(() =>
        expect(player.events.filter((event) => event.type === "scene-ping")).toHaveLength(count + 1)
      );
    }
    expect(player.socket.readyState).toBe(WebSocket.OPEN);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("terminates an unresponsive socket and records useful diagnostics without payloads or credentials", async () => {
    const player = await connect(2, { autoPong: false });
    const ping = once(player.socket, "ping");
    await vi.advanceTimersByTimeAsync(25_000);
    await ping;
    const closed = once(player.socket, "close");
    await vi.advanceTimersByTimeAsync(25_000);
    expect((await closed)[0]).toBe(1006);
    expect(logger.warn).toHaveBeenCalledWith(
      "WebSocket heartbeat timed out",
      expect.objectContaining({
        accountId: 2,
        roomId: 1,
        connectionId: expect.any(String),
        durationMs: expect.any(Number),
        closeCause: "heartbeat-timeout"
      })
    );
    await vi.waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith(
        "WebSocket closed",
        expect.objectContaining({ closeCode: 1006, closeCause: "heartbeat-timeout" })
      )
    );
    const logs = JSON.stringify([vi.mocked(logger.info).mock.calls, vi.mocked(logger.warn).mock.calls]);
    expect(logs).not.toContain("session-2");
    expect(logs).not.toContain("devils_session");
  });

  it("does not delay session revocation or publish a pending departure for removed membership", async () => {
    const gm = await connect(1);
    const player = await connect(2);
    await flush(gm);
    gm.events.length = 0;
    const closed = once(player.socket, "close");
    disconnectSession("session-2");
    expect((await closed)[0]).toBe(4001);
    await vi.waitFor(() =>
      expect(logger.info).toHaveBeenCalledWith(
        "WebSocket closed",
        expect.objectContaining({
          accountId: 2,
          closeCode: 4001,
          closeCause: "session-revoked"
        })
      )
    );
    db.exec("DELETE FROM memberships WHERE room_id = 1 AND account_id = 2;");
    await vi.advanceTimersByTimeAsync(10_000);
    await flush(gm);
    expect(notices(gm)).toEqual([]);
  });

  it("omits malformed payload text and peer close reasons from diagnostics", async () => {
    const player = await connect(2);
    player.socket.send('{"secret":"private-payload-do-not-log", invalid');
    await vi.waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith(
        "Ignored invalid WebSocket message",
        expect.objectContaining({ accountId: 2, errorType: "SyntaxError" })
      )
    );
    const closed = once(player.socket, "close");
    player.socket.close(1000, "private-close-reason-do-not-log");
    await closed;
    await vi.waitFor(() => expect(closedLogs()).toHaveLength(1));
    const logs = JSON.stringify([vi.mocked(logger.info).mock.calls, vi.mocked(logger.warn).mock.calls]);
    expect(logs).not.toContain("private-payload-do-not-log");
    expect(logs).not.toContain("private-close-reason-do-not-log");
    expect(logs).not.toContain("session-2");
  });
});
