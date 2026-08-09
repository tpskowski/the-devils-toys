import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs one smoke test against a freshly built production server.
 *
 * The server gets an empty data directory and a free port, so scripts never collide and never
 * touch the configured database. `run` receives the request, session, and socket helpers below;
 * everything is torn down afterwards whether it passed or threw.
 */
export async function runSmoke(name, run, { env = {}, withTablesServer = false } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "devils-toys-smoke-"));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let output = "";

  /**
   * Spawns a server and hands back a `stop` that can be called more than once.
   * The exit is awaited through a promise made now rather than by listening
   * after the fact: a process killed by a signal leaves `exitCode` null, so
   * asking again later would wait for an event that has already been and gone.
   */
  function start(entry, extraEnv) {
    const child = spawn(process.execPath, [entry], {
      cwd: process.cwd(),
      env: { ...process.env, DEVILS_TOYS_DATA_DIR: dataDir, ...extraEnv, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.on("data", (chunk) => (output += chunk.toString()));
    child.stderr.on("data", (chunk) => (output += chunk.toString()));
    const exited = new Promise((resolve) => child.once("exit", resolve));
    return {
      child,
      stop: async () => {
        child.kill();
        await exited;
      }
    };
  }

  // The Devil's Tables runs as a second process against the same database, so a
  // test that wants it gets its own port and shares this data directory. The
  // game server is told that port too, since it reports where the editor is and
  // whether it is answering; left to the default it would probe whatever else
  // happens to be listening on 4100.
  const tablesPort = withTablesServer ? await freePort() : undefined;
  const tablesBase = withTablesServer ? `http://127.0.0.1:${tablesPort}` : undefined;

  const server = start("server/dist/index.js", {
    PORT: String(port),
    ...(tablesPort ? { DEVILS_TABLES_PORT: String(tablesPort) } : {})
  });
  const tablesServer = withTablesServer
    ? start("server/dist/tables-server.js", { DEVILS_TABLES_PORT: String(tablesPort) })
    : undefined;

  const sockets = [];

  async function readyAt(url, label) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        if ((await fetch(`${url}/api/status`)).ok) return;
      } catch {}
      await sleep(100);
    }
    throw new Error(`${name} ${label} did not become ready. ${output}`);
  }

  async function ready() {
    await readyAt(base, "server");
    if (tablesBase) await readyAt(tablesBase, "tables server");
  }

  /** Stops the game server, to prove The Devil's Tables stands on its own. */
  const stopGameServer = () => server.stop();

  async function json(pathname, init = {}, expected = 200) {
    const response = await fetch(`${base}${pathname}`, init);
    assert.equal(response.status, expected, `${pathname} returned ${response.status}`);
    return { response, body: response.status === 204 ? undefined : await response.json() };
  }

  /** The same, against The Devil's Tables rather than the game server. */
  async function tablesJson(pathname, init = {}, expected = 200) {
    const response = await fetch(`${tablesBase}${pathname}`, init);
    assert.equal(response.status, expected, `${pathname} returned ${response.status}`);
    const type = response.headers.get("content-type") ?? "";
    if (response.status === 204) return { response, body: undefined };
    if (!type.includes("application/json")) return { response, body: undefined };
    return { response, body: await response.json() };
  }

  /** A download from The Devil's Tables, as the bytes it sent. */
  async function tablesBytes(pathname, init = {}, expected = 200) {
    const response = await fetch(`${tablesBase}${pathname}`, init);
    assert.equal(response.status, expected, `${pathname} returned ${response.status}`);
    return { response, bytes: Buffer.from(await response.arrayBuffer()) };
  }

  async function request(pathname, init = {}, expected = 200) {
    return (await json(pathname, init, expected)).body;
  }

  function cookieOf(response, label) {
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie, `${label} did not create a session cookie.`);
    return cookie;
  }

  const jsonHeaders = (cookie) => ({ "content-type": "application/json", cookie });

  async function setup(username, password) {
    const { response, body } = await json(
      "/api/setup",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password })
      },
      201
    );
    const cookie = cookieOf(response, "Setup");
    return { cookie, headers: jsonHeaders(cookie), account: body.account, body };
  }

  async function login(username, password) {
    const { response, body } = await json("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const cookie = cookieOf(response, "Login");
    return { cookie, headers: jsonHeaders(cookie), account: body.account, body };
  }

  async function redeem(token, password) {
    const { response, body } = await json(`/api/invitations/${token}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password })
    });
    const cookie = cookieOf(response, "Invitation redemption");
    return { cookie, headers: jsonHeaders(cookie), account: body.account, body };
  }

  async function upload(pathname, cookie, fields, expected = 201) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return json(pathname, { method: "POST", headers: { cookie }, body: form }, expected);
  }

  /**
   * A socket at the table (`join`), or one watching from Room Config (`watch`).
   * A watcher is sent change notices and nothing else, and never enters the
   * room's presence, so the two modes are worth telling apart here.
   */
  async function connect(cookie, roomId, { mode = "join" } = {}) {
    const events = [];
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: cookie } });
    sockets.push(socket);
    socket.on("message", (raw) => events.push(JSON.parse(raw.toString())));
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.send(JSON.stringify({ type: mode, roomId }));
    return { socket, events };
  }

  /**
   * Polls `events` until one matches. `match` is either an event type or a predicate.
   * Pass `latest` when earlier events can also match and only the newest one is the answer,
   * as with presence counts that climb while players are still connecting.
   */
  async function waitFor(events, match, label = String(match), { latest = false } = {}) {
    const predicate = typeof match === "function" ? match : (event) => event.type === match;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const found = latest ? [...events].reverse().find(predicate) : events.find(predicate);
      if (found) return found;
      await sleep(25);
    }
    throw new Error(`Timed out waiting for ${label}.`);
  }

  try {
    await ready();
    await run({
      base,
      port,
      dataDir,
      json,
      request,
      cookieOf,
      jsonHeaders,
      setup,
      login,
      redeem,
      upload,
      connect,
      waitFor,
      sleep,
      tablesBase,
      tablesPort,
      tablesJson,
      tablesBytes,
      stopGameServer,
      serverOutput: () => output
    });
    console.log(`${name} passed.`);
  } finally {
    for (const socket of sockets) socket.close();
    for (const running of [server, tablesServer]) await running?.stop();
    await rm(dataDir, { recursive: true, force: true });
  }
}
