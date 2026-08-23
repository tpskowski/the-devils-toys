import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthAccount, AuthedRequest } from "./auth.js";
import { db } from "./db.js";
import { npcRouter } from "./npcs.js";
import { installToybox } from "./test-fixture.js";

installToybox();

const ROOM = 1;
const gm: AuthAccount = { id: 1, username: "GM", isAdmin: false, role: "gm" };
const player: AuthAccount = { id: 2, username: "Player", isAdmin: false, role: "player" };
const outsider: AuthAccount = { id: 3, username: "Outsider", isAdmin: false, role: "player" };
const administrator: AuthAccount = { id: 4, username: "Admin", isAdmin: true, role: "admin" };
const accounts = new Map([gm, player, outsider, administrator].map((account) => [String(account.id), account]));

let server: http.Server;
let origin = "";
let revealedNpcId = 0;
let hiddenNpcId = 0;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: AuthedRequest, _res, next) => {
    req.account = accounts.get(String(req.header("x-test-account") ?? ""));
    next();
  });
  app.use("/api", npcRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not listen on TCP.");
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

async function request(account: AuthAccount, path: string, init: RequestInit = {}) {
  return fetch(`${origin}/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-test-account": String(account.id), ...init.headers }
  });
}

beforeEach(() => {
  db.exec(
    "PRAGMA foreign_keys = OFF; DELETE FROM room_tags; DELETE FROM custom_npcs; DELETE FROM memberships;" +
      " DELETE FROM rooms; DELETE FROM accounts; PRAGMA foreign_keys = ON;"
  );
  for (const account of [gm, player, outsider, administrator])
    db.prepare(
      "INSERT INTO accounts (id, username, password_hash, is_admin, account_role) VALUES (?, ?, '', ?, ?)"
    ).run(account.id, account.username, Number(account.isAdmin), account.role);
  db.prepare("INSERT INTO rooms (id, name, system, theme, created_by) VALUES (?, 'Table', 'toybox', 'grim', ?)").run(
    ROOM,
    gm.id
  );
  for (const [account, role] of [
    [gm, "gm"],
    [player, "player"]
  ] as const)
    db.prepare("INSERT INTO memberships (room_id, account_id, role) VALUES (?, ?, ?)").run(ROOM, account.id, role);
  revealedNpcId = Number(
    db
      .prepare(
        "INSERT INTO custom_npcs (room_id, created_by, name, notes, statblock_json, revealed) VALUES (?, 1, ?, ?, ?, 1)"
      )
      .run(ROOM, "The Broker", "Secret patron and safehouse", '{"hp":8}').lastInsertRowid
  );
  hiddenNpcId = Number(
    db
      .prepare("INSERT INTO custom_npcs (room_id, created_by, name, notes, statblock_json) VALUES (?, 1, ?, ?, ?)")
      .run(ROOM, "The Queen", "Her true name is hidden", '{"hp":99}').lastInsertRowid
  );
});

describe("revealed NPCs", () => {
  it("sends a room player only revealed IDs and names", async () => {
    const response = await request(player, `/rooms/${ROOM}/npcs/revealed`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ npcs: [{ id: revealedNpcId, name: "The Broker" }] });
  });

  it("does not let a player enumerate another room's cast", async () => {
    expect((await request(outsider, `/rooms/${ROOM}/npcs/revealed`)).status).toBe(404);
  });

  it("lets a GM reveal and unshare a cast member, but never a player", async () => {
    const playerAttempt = await request(player, `/rooms/${ROOM}/npcs/${hiddenNpcId}/reveal`, {
      method: "POST",
      body: JSON.stringify({ revealed: true })
    });
    expect(playerAttempt.status).toBe(403);
    expect(db.prepare("SELECT revealed FROM custom_npcs WHERE id = ?").get(hiddenNpcId)).toEqual({ revealed: 0 });

    const reveal = await request(gm, `/rooms/${ROOM}/npcs/${hiddenNpcId}/reveal`, {
      method: "POST",
      body: JSON.stringify({ revealed: true })
    });
    expect(reveal.status).toBe(204);
    expect(await (await request(player, `/rooms/${ROOM}/npcs/revealed`)).json()).toEqual({
      npcs: [
        { id: revealedNpcId, name: "The Broker" },
        { id: hiddenNpcId, name: "The Queen" }
      ]
    });

    expect(
      (
        await request(administrator, `/rooms/${ROOM}/npcs/${hiddenNpcId}/reveal`, {
          method: "POST",
          body: JSON.stringify({ revealed: false })
        })
      ).status
    ).toBe(204);
    expect(await (await request(player, `/rooms/${ROOM}/npcs/revealed`)).json()).toEqual({
      npcs: [{ id: revealedNpcId, name: "The Broker" }]
    });
  });

  it("refuses malformed reveal changes and nonexistent NPCs", async () => {
    expect(
      (
        await request(gm, `/rooms/${ROOM}/npcs/${hiddenNpcId}/reveal`, {
          method: "POST",
          body: JSON.stringify({ revealed: 1 })
        })
      ).status
    ).toBe(400);
    expect(
      (
        await request(gm, `/rooms/${ROOM}/npcs/999999/reveal`, {
          method: "POST",
          body: JSON.stringify({ revealed: true })
        })
      ).status
    ).toBe(404);
  });
});
