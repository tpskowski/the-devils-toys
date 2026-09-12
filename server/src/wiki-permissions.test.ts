import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthAccount, AuthedRequest } from "./auth.js";
import { db } from "./db.js";
import {
  mayEditWikiFile,
  mayManageWikiFolder,
  mayReadWikiFile,
  wikiRole,
  type WikiFolderPermissionRow,
  type WikiPagePermissionRow
} from "./wiki-permissions.js";
import { wikiRouter } from "./wiki.js";
import { mediaRouter } from "./media.js";
import { characterItemsFor } from "./character-items.js";
import { installToybox } from "./test-fixture.js";

installToybox();

const ROOM = 1;

const gm: AuthAccount = { id: 1, username: "GM", isAdmin: false, role: "gm" };
const owner: AuthAccount = { id: 2, username: "Owner", isAdmin: false, role: "player" };
const otherPlayer: AuthAccount = { id: 3, username: "Other", isAdmin: false, role: "player" };
const administrator: AuthAccount = { id: 4, username: "Admin", isAdmin: true, role: "admin" };

const privatePage: WikiPagePermissionRow = { room_id: ROOM, owner_account_id: owner.id, visible: 0 };
const sharedPage: WikiPagePermissionRow = { ...privatePage, visible: 1 };
const ownedFolder: WikiFolderPermissionRow = { room_id: ROOM, owner_account_id: owner.id };

const accounts = new Map([gm, owner, otherPlayer, administrator].map((account) => [String(account.id), account]));
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
  app.use("/api", mediaRouter);
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
  // This isolated fixture changes the accounts that own pages and folders. A
  // direct reset is deliberate: other suite-level fixture rows can retain a
  // nullable account reference while this router test replaces its principals.
  db.exec(
    "PRAGMA foreign_keys = OFF; DELETE FROM wiki_mentions; DELETE FROM wiki_pages; DELETE FROM wiki_folders; DELETE FROM custom_npcs;" +
      " DELETE FROM media; DELETE FROM room_state; DELETE FROM group_hirelings; DELETE FROM room_items; DELETE FROM memberships;" +
      " DELETE FROM rooms; DELETE FROM accounts; PRAGMA foreign_keys = ON;"
  );
  for (const account of [gm, owner, otherPlayer, administrator])
    db.prepare(
      "INSERT INTO accounts (id, username, password_hash, is_admin, account_role) VALUES (?, ?, '', ?, ?)"
    ).run(account.id, account.username, Number(account.isAdmin), account.role);
  db.prepare(
    "INSERT INTO rooms (id, name, system, theme, wiki_enabled, created_by) VALUES (?, 'Table', 'toybox', 'grim', 1, ?)"
  ).run(ROOM, gm.id);
  for (const [account, role] of [
    [gm, "gm"],
    [owner, "player"],
    [otherPlayer, "player"]
  ] as const)
    db.prepare("INSERT INTO memberships (room_id, account_id, role) VALUES (?, ?, ?)").run(ROOM, account.id, role);
});

describe("wiki access", () => {
  it("lets only the owner, the room GM, and an administrator read a private page", () => {
    expect(mayReadWikiFile(owner, privatePage)).toBe(true);
    expect(mayReadWikiFile(gm, privatePage)).toBe(true);
    expect(mayReadWikiFile(administrator, privatePage)).toBe(true);
    expect(mayReadWikiFile(otherPlayer, privatePage)).toBe(false);
  });

  it("shares reading with another player without sharing edit control", () => {
    expect(mayReadWikiFile(otherPlayer, sharedPage)).toBe(true);
    expect(mayEditWikiFile(otherPlayer, sharedPage)).toBe(false);
  });

  it("keeps edits to the owner and room administrators even after a page is shared", () => {
    for (const page of [privatePage, sharedPage]) {
      expect(mayEditWikiFile(owner, page)).toBe(true);
      expect(mayEditWikiFile(gm, page)).toBe(true);
      expect(mayEditWikiFile(administrator, page)).toBe(true);
      expect(mayEditWikiFile(otherPlayer, page)).toBe(false);
    }
  });

  it("lets the owner and room administrators manage a folder, but not another player", () => {
    expect(mayManageWikiFolder(owner, ownedFolder)).toBe(true);
    expect(mayManageWikiFolder(gm, ownedFolder)).toBe(true);
    expect(mayManageWikiFolder(administrator, ownedFolder)).toBe(true);
    expect(mayManageWikiFolder(otherPlayer, ownedFolder)).toBe(false);
  });

  it("takes every wiki route away when the room switches the feature off", () => {
    expect(wikiRole(owner, ROOM)).toBe("player");
    expect(wikiRole(gm, ROOM)).toBe("gm");
    expect(wikiRole(administrator, ROOM)).toBe("gm");

    db.prepare("UPDATE rooms SET wiki_enabled = 0 WHERE id = ?").run(ROOM);
    expect(wikiRole(owner, ROOM)).toBeUndefined();
    expect(wikiRole(gm, ROOM)).toBeUndefined();
    expect(wikiRole(administrator, ROOM)).toBeUndefined();
  });
});

describe("map legends", () => {
  function addMap(visible = true) {
    const result = db
      .prepare(
        `INSERT INTO media (room_id, uploaded_by, kind, category, filename, stored_name, visible, mime_type, size)
         VALUES (?, ?, 'scene', 'map', 'undercroft.png', 'undercroft.png', ?, 'image/png', 10)`
      )
      .run(ROOM, gm.id, Number(visible));
    const id = Number(result.lastInsertRowid);
    db.prepare("INSERT INTO room_state (room_id, map_id) VALUES (?, ?)").run(ROOM, id);
    return id;
  }

  async function addPage(title: string) {
    const response = await request(gm, `/rooms/${ROOM}/wiki/pages`, {
      method: "POST",
      body: JSON.stringify({ title, markdown: "" })
    });
    return ((await response.json()) as { page: { slug: string } }).page;
  }

  it("switches a map directly from one page to another", async () => {
    const mapId = addMap();
    const first = await addPage("First legend");
    const second = await addPage("Second legend");

    expect(
      (
        await request(gm, `/rooms/${ROOM}/maps/${mapId}/legend`, {
          method: "POST",
          body: JSON.stringify({ slug: first.slug })
        })
      ).status
    ).toBe(200);
    expect(
      (
        await request(gm, `/rooms/${ROOM}/maps/${mapId}/legend`, {
          method: "POST",
          body: JSON.stringify({ slug: second.slug })
        })
      ).status
    ).toBe(200);

    expect(db.prepare("SELECT slug, map_media_id FROM wiki_pages WHERE room_id = ? ORDER BY slug").all(ROOM)).toEqual([
      { slug: first.slug, map_media_id: null },
      { slug: second.slug, map_media_id: mapId }
    ]);
  });

  it("does not expose a private legend through an otherwise visible map", async () => {
    const mapId = addMap();
    const page = await addPage("Private legend");
    await request(gm, `/rooms/${ROOM}/maps/${mapId}/legend`, {
      method: "POST",
      body: JSON.stringify({ slug: page.slug })
    });

    const playerMedia = await request(otherPlayer, `/rooms/${ROOM}/media`);
    expect(playerMedia.status).toBe(200);
    expect((await playerMedia.json()) as { map: { legend?: unknown } }).toMatchObject({ map: { legend: null } });

    await request(gm, `/rooms/${ROOM}/wiki/pages/${page.slug}/reveal`, {
      method: "POST",
      body: JSON.stringify({ visible: true })
    });
    const sharedMedia = await request(otherPlayer, `/rooms/${ROOM}/media`);
    expect((await sharedMedia.json()) as { map: { legend?: unknown } }).toMatchObject({
      map: { legend: { slug: page.slug, title: "Private legend" } }
    });
  });
});

describe("wiki routes", () => {
  function insertFolder(name: string, ownerAccountId: number, parentId: number | null = null) {
    return Number(
      db
        .prepare("INSERT INTO wiki_folders (room_id, parent_id, name, owner_account_id) VALUES (?, ?, ?, ?)")
        .run(ROOM, parentId, name, ownerAccountId).lastInsertRowid
    );
  }

  function insertPage({
    slug,
    title,
    markdown,
    ownerAccountId,
    visible = false,
    folderId = null
  }: {
    slug: string;
    title: string;
    markdown: string;
    ownerAccountId: number;
    visible?: boolean;
    folderId?: number | null;
  }) {
    return Number(
      db
        .prepare(
          `INSERT INTO wiki_pages (room_id, folder_id, slug, title, markdown, visible, owner_account_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(ROOM, folderId, slug, title, markdown, Number(visible), ownerAccountId).lastInsertRowid
    );
  }

  it("hides another player's private page from reads, lists, and search while retaining only accessible folder paths", async () => {
    const sharedRoot = insertFolder("Shared path", gm.id);
    const sharedChild = insertFolder("Under the city", gm.id, sharedRoot);
    const ownFolder = insertFolder("Owner drafts", owner.id);
    insertFolder("Other player's empty folder", otherPlayer.id);
    insertPage({
      slug: "shared-ledger",
      title: "Shared ledger",
      markdown: "A public debt.",
      ownerAccountId: owner.id,
      visible: true,
      folderId: sharedChild
    });
    insertPage({
      slug: "owner-note",
      title: "Owner note",
      markdown: "My private draft.",
      ownerAccountId: owner.id,
      folderId: ownFolder
    });
    insertPage({
      slug: "other-secret",
      title: "Other secret",
      markdown: "needle-private-search-text",
      ownerAccountId: otherPlayer.id
    });

    const privateRead = await request(owner, `/rooms/${ROOM}/wiki/pages/other-secret`);
    expect(privateRead.status).toBe(404);

    const list = await request(owner, `/rooms/${ROOM}/wiki`);
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { pages: { slug: string }[]; folders: { id: number; name: string }[] };
    expect(listed.pages.map((page) => page.slug)).toEqual(["owner-note", "shared-ledger"]);
    expect(listed.folders.map((folder) => folder.id)).toEqual(
      expect.arrayContaining([sharedRoot, sharedChild, ownFolder])
    );
    expect(listed.folders.map((folder) => folder.name)).not.toContain("Other player's empty folder");

    const search = await request(owner, `/rooms/${ROOM}/wiki/search?q=needle-private-search-text`);
    expect(search.status).toBe(200);
    expect((await search.json()) as { pages: unknown[] }).toEqual({ pages: [] });
  });

  it("searches reader-facing prose and labels, never hidden directive ids or page slugs", async () => {
    const hiddenNpcId = Number(
      db
        .prepare("INSERT INTO custom_npcs (room_id, created_by, name, revealed) VALUES (?, ?, 'Unseen Broker', 0)")
        .run(ROOM, gm.id).lastInsertRowid
    );
    insertPage({ slug: "other-private", title: "Other private", markdown: "private", ownerAccountId: otherPlayer.id });
    insertPage({
      slug: "safe-search-copy",
      title: "Safe search copy",
      markdown: `Public prose and :npc[Known contact]{id=${hiddenNpcId}} beside :page[Old notes]{slug=other-private}.`,
      ownerAccountId: gm.id,
      visible: true
    });
    // Malformed directives are ordinary reader-facing text, but their
    // attributes still cannot become a search side channel.
    insertPage({
      slug: "safe-search-malformed",
      title: "Malformed directive",
      markdown: `:npc[Look harmless]{id=${hiddenNpcId} class=chip}`,
      ownerAccountId: gm.id,
      visible: true
    });

    for (const query of [String(hiddenNpcId), "other-private", "class=chip"]) {
      const response = await request(owner, `/rooms/${ROOM}/wiki/search?q=${encodeURIComponent(query)}`);
      expect(response.status).toBe(200);
      expect((await response.json()) as { pages: unknown[] }).toEqual({ pages: [] });
    }
    for (const query of ["Public prose", "Known contact", "Old notes"]) {
      const response = await request(owner, `/rooms/${ROOM}/wiki/search?q=${encodeURIComponent(query)}`);
      expect((await response.json()) as { pages: { slug: string }[] }).toMatchObject({
        pages: [{ slug: "safe-search-copy" }]
      });
    }
    const malformedLabel = await request(owner, `/rooms/${ROOM}/wiki/search?q=Look%20harmless`);
    expect((await malformedLabel.json()) as { pages: { slug: string }[] }).toMatchObject({
      pages: [{ slug: "safe-search-malformed" }]
    });
  });

  it("lets only the GM share or unshare a page, revoking another player's access immediately", async () => {
    insertPage({
      slug: "private-brief",
      title: "Private brief",
      markdown: "Never reveal this without the GM.",
      ownerAccountId: owner.id
    });

    const playerReveal = await request(owner, `/rooms/${ROOM}/wiki/pages/private-brief/reveal`, {
      method: "POST",
      body: JSON.stringify({ visible: true })
    });
    expect(playerReveal.status).toBe(403);
    expect((await request(otherPlayer, `/rooms/${ROOM}/wiki/pages/private-brief`)).status).toBe(404);

    expect(
      (
        await request(gm, `/rooms/${ROOM}/wiki/pages/private-brief/reveal`, {
          method: "POST",
          body: JSON.stringify({ visible: true })
        })
      ).status
    ).toBe(200);
    expect((await request(otherPlayer, `/rooms/${ROOM}/wiki/pages/private-brief`)).status).toBe(200);

    expect(
      (
        await request(gm, `/rooms/${ROOM}/wiki/pages/private-brief/reveal`, {
          method: "POST",
          body: JSON.stringify({ visible: false })
        })
      ).status
    ).toBe(200);
    expect((await request(otherPlayer, `/rooms/${ROOM}/wiki/pages/private-brief`)).status).toBe(404);
  });

  it("returns the current page at 409 rather than overwriting a later revision", async () => {
    insertPage({
      slug: "contested-note",
      title: "Contested note",
      markdown: "first draft",
      ownerAccountId: owner.id
    });
    const first = await request(owner, `/rooms/${ROOM}/wiki/pages/contested-note`, {
      method: "PUT",
      body: JSON.stringify({ revision: 0, markdown: "newer draft" })
    });
    expect(first.status).toBe(200);
    expect((await first.json()) as { page: { revision: number } }).toMatchObject({ page: { revision: 1 } });

    const stale = await request(owner, `/rooms/${ROOM}/wiki/pages/contested-note`, {
      method: "PUT",
      body: JSON.stringify({ revision: 0, markdown: "stale overwrite" })
    });
    expect(stale.status).toBe(409);
    expect((await stale.json()) as { page: { markdown: string; revision: number } }).toMatchObject({
      page: { markdown: "newer draft", revision: 1 }
    });
  });

  it("does not let a player probe hidden targets through the picker or a forged directive", async () => {
    const hiddenNpcId = Number(
      db
        .prepare("INSERT INTO custom_npcs (room_id, created_by, name, revealed) VALUES (?, ?, 'Hidden Broker', 0)")
        .run(ROOM, gm.id).lastInsertRowid
    );
    const revealedNpcId = Number(
      db
        .prepare("INSERT INTO custom_npcs (room_id, created_by, name, revealed) VALUES (?, ?, 'Known Broker', 1)")
        .run(ROOM, gm.id).lastInsertRowid
    );
    insertPage({ slug: "other-private", title: "Other private", markdown: "private", ownerAccountId: otherPlayer.id });

    const picker = await request(owner, `/rooms/${ROOM}/wiki/mentionables?q=broker`);
    expect(picker.status).toBe(200);
    expect((await picker.json()) as { mentionables: { kind: string; id?: number; label: string }[] }).toMatchObject({
      mentionables: [{ kind: "npc", id: revealedNpcId, label: "Known Broker" }]
    });
    const listed = (await request(owner, `/rooms/${ROOM}/wiki/mentionables?q=`)).status;
    expect(listed).toBe(200);

    const forgedNpc = await request(owner, `/rooms/${ROOM}/wiki/pages`, {
      method: "POST",
      body: JSON.stringify({ title: "Probe", markdown: `:npc[Hidden Broker]{id=${hiddenNpcId}}` })
    });
    expect(forgedNpc.status).toBe(400);
    const forgedPage = await request(owner, `/rooms/${ROOM}/wiki/pages`, {
      method: "POST",
      body: JSON.stringify({ title: "Probe two", markdown: ":page[Other private]{slug=other-private}" })
    });
    expect(forgedPage.status).toBe(400);
    expect(db.prepare("SELECT COUNT(*) AS count FROM wiki_pages WHERE title LIKE 'Probe%'").get()).toEqual({
      count: 0
    });
  });

  it("excludes spawned encounter copies from wiki mention resolution and pickers", async () => {
    const spawnedNpcId = Number(
      db
        .prepare(
          "INSERT INTO custom_npcs (room_id, created_by, name, revealed, spawned) VALUES (?, ?, 'Spawned Broker', 1, 1)"
        )
        .run(ROOM, gm.id).lastInsertRowid
    );

    for (const account of [gm, owner]) {
      const picker = await request(account, `/rooms/${ROOM}/wiki/mentionables?q=spawned`);
      expect((await picker.json()) as { mentionables: { id?: number }[] }).toEqual({ mentionables: [] });
      const created = await request(account, `/rooms/${ROOM}/wiki/pages`, {
        method: "POST",
        body: JSON.stringify({
          title: `Spawned probe ${account.id}`,
          markdown: `:npc[Spawned Broker]{id=${spawnedNpcId}}`
        })
      });
      expect(created.status).toBe(400);
    }
  });

  it("normalizes stale mention directives on unrelated and active saves without accepting new hidden targets", async () => {
    const npcId = Number(
      db
        .prepare("INSERT INTO custom_npcs (room_id, created_by, name, revealed) VALUES (?, ?, 'Known Broker', 1)")
        .run(ROOM, gm.id).lastInsertRowid
    );
    const created = await request(owner, `/rooms/${ROOM}/wiki/pages`, {
      method: "POST",
      body: JSON.stringify({ title: "Leads", markdown: `Meet :npc[Known Broker]{id=${npcId}}.` })
    });
    expect(created.status).toBe(201);
    const page = (await created.json()) as { page: { id: number; slug: string; revision: number } };

    // The author had a valid link when this draft was opened, but a later
    // unreveal must not make a title-only save impossible.
    db.prepare("UPDATE custom_npcs SET revealed = 0 WHERE id = ?").run(npcId);
    const titleOnly = await request(owner, `/rooms/${ROOM}/wiki/pages/${page.page.slug}`, {
      method: "PUT",
      body: JSON.stringify({ revision: page.page.revision, title: "Updated leads" })
    });
    expect(titleOnly.status).toBe(200);
    const normalizedPage = (await titleOnly.json()) as {
      page: { id: number; slug: string; markdown: string; revision: number };
    };
    expect(normalizedPage.page.markdown).toBe("Meet Known Broker.");
    expect(db.prepare("SELECT * FROM wiki_mentions WHERE page_id = ?").all(normalizedPage.page.id)).toEqual([]);

    // A stale active draft may still contain its old directive while the
    // author changes another sentence.  The old directive becomes prose.
    db.prepare("UPDATE custom_npcs SET revealed = 1 WHERE id = ?").run(npcId);
    const second = await request(owner, `/rooms/${ROOM}/wiki/pages`, {
      method: "POST",
      body: JSON.stringify({ title: "Second lead", markdown: `Follow :npc[Known Broker]{id=${npcId}} tonight.` })
    });
    expect(second.status).toBe(201);
    const activePage = (await second.json()) as { page: { id: number; slug: string; revision: number } };
    db.prepare("UPDATE custom_npcs SET revealed = 0 WHERE id = ?").run(npcId);
    const forgedRelabel = await request(owner, `/rooms/${ROOM}/wiki/pages/${activePage.page.slug}`, {
      method: "PUT",
      body: JSON.stringify({
        revision: activePage.page.revision,
        markdown: `Follow :npc[Different label]{id=${npcId}} tonight.`
      })
    });
    expect(forgedRelabel.status).toBe(400);
    // Moving the target to another room must be indistinguishable from it
    // disappearing: the stale source becomes prose and cannot retain a
    // cross-room foreign-keyed mention row.
    db.prepare(
      "INSERT INTO rooms (id, name, system, theme, wiki_enabled, created_by) VALUES (2, 'Elsewhere', 'toybox', 'grim', 1, ?)"
    ).run(gm.id);
    db.prepare("UPDATE custom_npcs SET room_id = 2 WHERE id = ?").run(npcId);
    const activeEdit = await request(owner, `/rooms/${ROOM}/wiki/pages/${activePage.page.slug}`, {
      method: "PUT",
      body: JSON.stringify({
        revision: activePage.page.revision,
        markdown: `Follow :npc[Known Broker]{id=${npcId}} tomorrow.`
      })
    });
    expect(activeEdit.status).toBe(200);
    expect(((await activeEdit.json()) as { page: { markdown: string } }).page.markdown).toBe(
      "Follow Known Broker tomorrow."
    );
    expect(db.prepare("SELECT * FROM wiki_mentions WHERE page_id = ?").all(activePage.page.id)).toEqual([]);

    const forged = await request(owner, `/rooms/${ROOM}/wiki/pages/${activePage.page.slug}`, {
      method: "PUT",
      body: JSON.stringify({ revision: 1, markdown: ":npc[Different label]{id=999999}" })
    });
    expect(forged.status).toBe(400);
  });

  it("rewrites the index whole, cascades a deleted target, and sends a hidden target as plain prose", async () => {
    const npcId = Number(
      db
        .prepare("INSERT INTO custom_npcs (room_id, created_by, name, revealed) VALUES (?, ?, 'Secret Name', 0)")
        .run(ROOM, gm.id).lastInsertRowid
    );
    const catalogueItem = Object.values(characterItemsFor("toybox", ROOM)).flat()[0]!;
    const created = await request(gm, `/rooms/${ROOM}/wiki/pages`, {
      method: "POST",
      body: JSON.stringify({
        title: "GM notes",
        markdown: `Meet :npc[Secret Name]{id=${npcId}} with :item[${catalogueItem.label}]{id=${catalogueItem.id}}.`
      })
    });
    expect(created.status).toBe(201);
    const page = (await created.json()) as { page: { id: number; slug: string; revision: number } };
    expect(
      db
        .prepare("SELECT kind, npc_id, item_id FROM wiki_mentions WHERE page_id = ? ORDER BY sort_order")
        .all(page.page.id)
    ).toEqual([
      { kind: "npc", npc_id: npcId, item_id: null },
      { kind: "item", npc_id: null, item_id: catalogueItem.id }
    ]);

    await request(gm, `/rooms/${ROOM}/wiki/pages/${page.page.slug}/reveal`, {
      method: "POST",
      body: JSON.stringify({ visible: true })
    });
    const playerRead = await request(owner, `/rooms/${ROOM}/wiki/pages/${page.page.slug}`);
    expect(playerRead.status).toBe(200);
    const playerMarkdown = ((await playerRead.json()) as { page: { markdown: string } }).page.markdown;
    expect(playerMarkdown).toContain("Secret Name");
    expect(playerMarkdown).not.toContain(":npc[");
    expect(playerMarkdown).not.toContain(`id=${npcId}`);

    // A player could save a link while the NPC was revealed, then lose that
    // visibility before a stale-write response is built.  The 409 is still a
    // page payload and must use the same reader-side reduction as GET.
    db.prepare("UPDATE custom_npcs SET revealed = 1 WHERE id = ?").run(npcId);
    const playerPageResponse = await request(owner, `/rooms/${ROOM}/wiki/pages`, {
      method: "POST",
      body: JSON.stringify({ title: "Player notes", markdown: `:npc[Secret Name]{id=${npcId}}` })
    });
    expect(playerPageResponse.status).toBe(201);
    const playerPage = (await playerPageResponse.json()) as { page: { slug: string; revision: number } };
    expect(
      (
        await request(gm, `/rooms/${ROOM}/wiki/pages/${playerPage.page.slug}`, {
          method: "PUT",
          body: JSON.stringify({ revision: playerPage.page.revision, title: "GM touched this" })
        })
      ).status
    ).toBe(200);
    db.prepare("UPDATE custom_npcs SET revealed = 0 WHERE id = ?").run(npcId);
    const staleAfterHide = await request(owner, `/rooms/${ROOM}/wiki/pages/${playerPage.page.slug}`, {
      method: "PUT",
      body: JSON.stringify({ revision: playerPage.page.revision, title: "stale title" })
    });
    expect(staleAfterHide.status).toBe(409);
    const staleMarkdown = ((await staleAfterHide.json()) as { page: { markdown: string } }).page.markdown;
    expect(staleMarkdown).toBe("Secret Name");

    const replaced = await request(gm, `/rooms/${ROOM}/wiki/pages/${page.page.slug}`, {
      method: "PUT",
      body: JSON.stringify({ revision: page.page.revision, markdown: "No links now." })
    });
    expect(replaced.status).toBe(200);
    expect(db.prepare("SELECT * FROM wiki_mentions WHERE page_id = ?").all(page.page.id)).toEqual([]);

    const again = await request(gm, `/rooms/${ROOM}/wiki/pages/${page.page.slug}`, {
      method: "PUT",
      body: JSON.stringify({ revision: 1, markdown: `Meet :npc[Secret Name]{id=${npcId}}.` })
    });
    expect(again.status).toBe(200);
    db.prepare("DELETE FROM custom_npcs WHERE id = ?").run(npcId);
    expect(db.prepare("SELECT * FROM wiki_mentions WHERE page_id = ?").all(page.page.id)).toEqual([]);
  });

  describe("map legends", () => {
    function addMap(visible = true) {
      const result = db
        .prepare(
          `INSERT INTO media (room_id, uploaded_by, kind, category, filename, stored_name, visible, mime_type, size)
           VALUES (?, ?, 'scene', 'map', 'undercroft.png', 'undercroft.png', ?, 'image/png', 10)`
        )
        .run(ROOM, gm.id, Number(visible));
      const id = Number(result.lastInsertRowid);
      db.prepare("INSERT INTO room_state (room_id, map_id) VALUES (?, ?)").run(ROOM, id);
      return id;
    }

    async function addPage(title: string) {
      const response = await request(gm, `/rooms/${ROOM}/wiki/pages`, {
        method: "POST",
        body: JSON.stringify({ title, markdown: "" })
      });
      return ((await response.json()) as { page: { slug: string } }).page;
    }

    it("switches a map directly from one page to another", async () => {
      const mapId = addMap();
      const first = await addPage("First legend");
      const second = await addPage("Second legend");

      expect(
        (
          await request(gm, `/rooms/${ROOM}/maps/${mapId}/legend`, {
            method: "POST",
            body: JSON.stringify({ slug: first.slug })
          })
        ).status
      ).toBe(200);
      expect(
        (
          await request(gm, `/rooms/${ROOM}/maps/${mapId}/legend`, {
            method: "POST",
            body: JSON.stringify({ slug: second.slug })
          })
        ).status
      ).toBe(200);
      expect(
        (
          await request(otherPlayer, `/rooms/${ROOM}/maps/${mapId}/legend`, {
            method: "POST",
            body: JSON.stringify({ slug: first.slug })
          })
        ).status
      ).toBe(403);

      expect(db.prepare("SELECT slug, map_media_id FROM wiki_pages WHERE room_id = ? ORDER BY slug").all(ROOM)).toEqual(
        [
          { slug: first.slug, map_media_id: null },
          { slug: second.slug, map_media_id: mapId }
        ]
      );
    });

    it("does not expose a private legend through an otherwise visible map", async () => {
      const mapId = addMap();
      const page = await addPage("Private legend");
      await request(gm, `/rooms/${ROOM}/maps/${mapId}/legend`, {
        method: "POST",
        body: JSON.stringify({ slug: page.slug })
      });

      const playerMedia = await request(otherPlayer, `/rooms/${ROOM}/media`);
      expect(playerMedia.status).toBe(200);
      expect((await playerMedia.json()) as { map: { legend?: unknown } }).toMatchObject({ map: { legend: null } });

      await request(gm, `/rooms/${ROOM}/wiki/pages/${page.slug}/reveal`, {
        method: "POST",
        body: JSON.stringify({ visible: true })
      });
      const sharedMedia = await request(otherPlayer, `/rooms/${ROOM}/media`);
      expect((await sharedMedia.json()) as { map: { legend?: unknown } }).toMatchObject({
        map: { legend: { slug: page.slug, title: "Private legend" } }
      });
    });
  });
});
