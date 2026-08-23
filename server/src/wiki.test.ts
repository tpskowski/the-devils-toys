import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthAccount, AuthedRequest } from "./auth.js";
import { db } from "./db.js";
import { installToybox } from "./test-fixture.js";
import { wikiRouter } from "./wiki.js";

installToybox();

const ROOM = 1;
const gm: AuthAccount = { id: 1, username: "GM", isAdmin: false, role: "gm" };
const player: AuthAccount = { id: 2, username: "Player", isAdmin: false, role: "player" };
const otherPlayer: AuthAccount = { id: 3, username: "Other", isAdmin: false, role: "player" };
const accounts = new Map([gm, player, otherPlayer].map((account) => [String(account.id), account]));

let server: http.Server;
let origin = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: AuthedRequest, _res, next) => {
    req.account = accounts.get(String(req.header("x-test-account") ?? ""));
    next();
  });
  app.use("/api", wikiRouter);
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
    "PRAGMA foreign_keys = OFF; DELETE FROM wiki_mentions; DELETE FROM wiki_pages; DELETE FROM wiki_folders; DELETE FROM custom_npcs;" +
      " DELETE FROM memberships; DELETE FROM rooms; DELETE FROM accounts; PRAGMA foreign_keys = ON;"
  );
  for (const account of [gm, player, otherPlayer])
    db.prepare(
      "INSERT INTO accounts (id, username, password_hash, is_admin, account_role) VALUES (?, ?, '', ?, ?)"
    ).run(account.id, account.username, Number(account.isAdmin), account.role);
  db.prepare(
    "INSERT INTO rooms (id, name, system, theme, wiki_enabled, created_by) VALUES (?, 'Table', 'toybox', 'grim', 1, ?)"
  ).run(ROOM, gm.id);
  for (const [account, role] of [
    [gm, "gm"],
    [player, "player"],
    [otherPlayer, "player"]
  ] as const)
    db.prepare("INSERT INTO memberships (room_id, account_id, role) VALUES (?, ?, ?)").run(ROOM, account.id, role);
});

describe("wiki CRUD", () => {
  it("refuses folder names that would turn into ambiguous archive paths", async () => {
    for (const name of [".", "..", "a/b", "a\\b", 'a"b', "a:"]) {
      const response = await request(player, `/rooms/${ROOM}/wiki/folders`, {
        method: "POST",
        body: JSON.stringify({ name })
      });
      expect(response.status).toBe(400);
    }
    const created = await request(player, `/rooms/${ROOM}/wiki/folders`, {
      method: "POST",
      body: JSON.stringify({ name: "portable" })
    });
    const { folder } = (await created.json()) as { folder: { id: number } };
    const renamed = await request(player, `/rooms/${ROOM}/wiki/folders/${folder.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "not/portable" })
    });
    expect(renamed.status).toBe(400);
  });

  it("keeps a minted slug stable while its owner renames, edits, and removes the page", async () => {
    const folderResponse = await request(player, `/rooms/${ROOM}/wiki/folders`, {
      method: "POST",
      body: JSON.stringify({ name: "Field notes" })
    });
    expect(folderResponse.status).toBe(201);
    const folder = (await folderResponse.json()) as { folder: { id: number } };

    const created = await request(player, `/rooms/${ROOM}/wiki/pages`, {
      method: "POST",
      body: JSON.stringify({ title: "The Old Ledger", markdown: "First draft", folderId: folder.folder.id })
    });
    expect(created.status).toBe(201);
    const page = (await created.json()) as { page: { slug: string; revision: number; folderId: number } };
    expect(page.page).toMatchObject({ slug: "the-old-ledger", revision: 0, folderId: folder.folder.id });

    const updated = await request(player, `/rooms/${ROOM}/wiki/pages/${page.page.slug}`, {
      method: "PUT",
      body: JSON.stringify({ revision: page.page.revision, title: "The New Ledger", markdown: "Second draft" })
    });
    expect(updated.status).toBe(200);
    expect(
      (await updated.json()) as { page: { slug: string; title: string; markdown: string; revision: number } }
    ).toMatchObject({
      page: { slug: "the-old-ledger", title: "The New Ledger", markdown: "Second draft", revision: 1 }
    });

    expect((await request(player, `/rooms/${ROOM}/wiki/pages/the-old-ledger`, { method: "DELETE" })).status).toBe(204);
    expect((await request(player, `/rooms/${ROOM}/wiki/pages/the-old-ledger`)).status).toBe(404);
  });

  it("refuses a folder cycle and non-empty deletion without moving its contents", async () => {
    const rootResponse = await request(player, `/rooms/${ROOM}/wiki/folders`, {
      method: "POST",
      body: JSON.stringify({ name: "Root" })
    });
    const root = (await rootResponse.json()) as { folder: { id: number } };
    const childResponse = await request(player, `/rooms/${ROOM}/wiki/folders`, {
      method: "POST",
      body: JSON.stringify({ name: "Child", parentId: root.folder.id })
    });
    const child = (await childResponse.json()) as { folder: { id: number } };

    expect(
      (
        await request(player, `/rooms/${ROOM}/wiki/folders/${root.folder.id}`, {
          method: "PATCH",
          body: JSON.stringify({ parentId: child.folder.id })
        })
      ).status
    ).toBe(400);
    expect((await request(player, `/rooms/${ROOM}/wiki/folders/${root.folder.id}`, { method: "DELETE" })).status).toBe(
      409
    );
    expect(db.prepare("SELECT parent_id FROM wiki_folders WHERE id = ?").get(root.folder.id)).toEqual({
      parent_id: null
    });
    expect(db.prepare("SELECT parent_id FROM wiki_folders WHERE id = ?").get(child.folder.id)).toEqual({
      parent_id: root.folder.id
    });

    expect((await request(player, `/rooms/${ROOM}/wiki/folders/${child.folder.id}`, { method: "DELETE" })).status).toBe(
      204
    );
    expect((await request(player, `/rooms/${ROOM}/wiki/folders/${root.folder.id}`, { method: "DELETE" })).status).toBe(
      204
    );
  });

  it("rewrites derived mentions on every save and lets foreign keys remove a deleted target", async () => {
    const npcId = Number(
      db
        .prepare("INSERT INTO custom_npcs (room_id, created_by, name, revealed) VALUES (?, ?, 'Broker', 0)")
        .run(ROOM, gm.id).lastInsertRowid
    );
    const created = await request(gm, `/rooms/${ROOM}/wiki/pages`, {
      method: "POST",
      body: JSON.stringify({ title: "A lead", markdown: `Meet :npc[Broker]{id=${npcId}}.` })
    });
    expect(created.status).toBe(201);
    const page = (await created.json()) as { page: { id: number; slug: string; revision: number } };
    expect(db.prepare("SELECT kind, npc_id FROM wiki_mentions WHERE page_id = ?").all(page.page.id)).toEqual([
      { kind: "npc", npc_id: npcId }
    ]);

    const removed = await request(gm, `/rooms/${ROOM}/wiki/pages/${page.page.slug}`, {
      method: "PUT",
      body: JSON.stringify({ revision: page.page.revision, markdown: "No lead." })
    });
    expect(removed.status).toBe(200);
    expect(db.prepare("SELECT * FROM wiki_mentions WHERE page_id = ?").all(page.page.id)).toEqual([]);

    const restored = await request(gm, `/rooms/${ROOM}/wiki/pages/${page.page.slug}`, {
      method: "PUT",
      body: JSON.stringify({ revision: 1, markdown: `Meet :npc[Broker]{id=${npcId}}.` })
    });
    expect(restored.status).toBe(200);
    db.prepare("DELETE FROM custom_npcs WHERE id = ?").run(npcId);
    expect(db.prepare("SELECT * FROM wiki_mentions WHERE page_id = ?").all(page.page.id)).toEqual([]);
  });
});
