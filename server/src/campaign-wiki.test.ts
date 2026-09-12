import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { strToU8, unzipSync, zipSync } from "fflate";
import { applyCampaign, type ApplyOptions } from "./campaign-apply.js";
import { CAMPAIGN_BUNDLE_VERSION, refuseUnacceptableEntries, WIKI_MARKDOWN_LIMIT_BYTES } from "./campaign-bundles.js";
import { exportRoomCampaign } from "./campaign-export.js";
import { campaignWikiDirectives, withCampaignWikiDirectiveTarget } from "./campaign-wiki-mentions.js";
import { stageCampaignArchive, type StagedCampaign } from "./campaign-staging.js";
import { config } from "./config.js";
import { all, db, one } from "./db.js";
import { installToybox } from "./test-fixture.js";
import type { ZipEntry } from "./zip-safety.js";

const toybox = installToybox();
const itemListKey = toybox.characterSheet.lists[0]?.key ?? "inventory";
const hitPointsKey = toybox.npcStatblock.hitPointsKey;

const ACCOUNT = 1;
let roomId = 0;

function clearTestRooms() {
  const roomIds = all<{ id: number }>("SELECT id FROM rooms WHERE created_by = ?", ACCOUNT).map((room) => room.id);
  if (!roomIds.length) return;
  const placeholders = roomIds.map(() => "?").join(", ");
  db.prepare(`DELETE FROM wiki_pages WHERE room_id IN (${placeholders})`).run(...roomIds);
  // The current development schema deliberately refuses direct deletion of a
  // non-empty folder. Remove this fixture's leaves first, then its rooms; a
  // production migration changes the room cascade itself.
  while (
    db
      .prepare(
        `DELETE FROM wiki_folders
          WHERE room_id IN (${placeholders})
            AND NOT EXISTS (SELECT 1 FROM wiki_folders child WHERE child.parent_id = wiki_folders.id)`
      )
      .run(...roomIds).changes
  ) {
    // Each pass removes one level of this test's folder tree.
  }
  db.prepare(`DELETE FROM rooms WHERE id IN (${placeholders})`).run(...roomIds);
}

beforeEach(() => {
  // This test file owns its rooms. Deleting them lets the database's cascading
  // relationships do their work without reaching into accounts or unrelated
  // tables, which was both brittle and needlessly destructive.
  clearTestRooms();
  db.prepare(
    `INSERT INTO accounts (id, username, password_hash, is_admin, account_role) VALUES (?, ?, '', 1, 'admin')
     ON CONFLICT(id) DO UPDATE SET username = excluded.username, is_admin = excluded.is_admin, account_role = excluded.account_role`
  ).run(ACCOUNT, "Admin");
  roomId = makeRoom("Source");
});

function makeRoom(name: string) {
  return Number(
    db.prepare("INSERT INTO rooms (name, system, theme, created_by) VALUES (?, 'toybox', 'grim', ?)").run(name, ACCOUNT)
      .lastInsertRowid
  );
}

const png = () => {
  const body = Buffer.alloc(96, 1);
  Buffer.from("89504e470d0a1a0a", "hex").copy(body);
  return new Uint8Array(body);
};

const text = (value: string) => strToU8(value);

function stage(files: Record<string, Uint8Array>): StagedCampaign {
  const archive = path.join(config.dataDir, `${Math.random().toString(36).slice(2)}.zip`);
  fs.writeFileSync(archive, zipSync(files, { level: 6 }));
  return stageCampaignArchive(archive, { roomId, accountId: ACCOUNT, archiveName: "wiki.devilcampaign.zip" });
}

function apply(files: Record<string, Uint8Array>, target = roomId, options: Partial<ApplyOptions> = {}) {
  const staged = stage(files);
  return applyCampaign(staged.directory, staged.campaign, target, ACCOUNT, {
    policy: "skip",
    takeRoomSettings: false,
    ...options
  });
}

function wikiBundle(markdown = "# Duchess", title = "The Duchess", visible = false) {
  return {
    "maps/undercroft.png": png(),
    "wiki/maps/the-undercroft.md": text(markdown),
    "wiki/index.json": text(
      JSON.stringify({
        files: [
          {
            file: "maps/the-undercroft.md",
            title,
            sortOrder: 7,
            visible,
            map: "maps/undercroft.png"
          }
        ],
        folders: [
          { path: "maps", sortOrder: 3 },
          { path: "unused/empty", sortOrder: 9 }
        ]
      })
    )
  };
}

const limits = { maxBytes: 1024, maxImageBytes: 512, maxAudioBytes: 512, maxEntries: 20 };
const entry = (name: string): ZipEntry => ({
  name,
  compressedSize: 1,
  uncompressedSize: 1,
  method: 0,
  headerOffset: 0
});

describe("wiki campaign topology", () => {
  it("allows bounded nesting only below wiki and refuses traversal or nested indexes", () => {
    expect(() => refuseUnacceptableEntries([entry("wiki/one/two/three/four/page.md")], limits)).not.toThrow();
    expect(() => refuseUnacceptableEntries([entry("maps/one/two.png")], limits)).toThrow(/is nested/);
    expect(() => refuseUnacceptableEntries([entry("wiki/one/two/three/four/five/page.md")], limits)).toThrow(
      /unsafe or over-deep wiki path/
    );
    expect(() => refuseUnacceptableEntries([entry("wiki/../private.md")], limits)).toThrow(
      /unsafe or over-deep wiki path/
    );
    // The importer writes these paths to disk before it can turn them into
    // database folders.  A colon, reserved DOS device name, or trailing space
    // would strand a bundle on Windows and make the next export fail.
    for (const name of ["wiki/notes:private/page.md", "wiki/CON.md", "wiki/notes /page.md"])
      expect(() => refuseUnacceptableEntries([entry(name)], limits)).toThrow(/unsafe or over-deep wiki path/);
    expect(() => refuseUnacceptableEntries([entry("wiki/folder/index.json")], limits)).toThrow(/is not Markdown/);
  });

  it("refuses unsafe index metadata and a legend that does not name a carried map", () => {
    expect(() =>
      stage({
        "wiki/index.json": text(JSON.stringify({ files: [], folders: [{ path: "../private", sortOrder: 0 }] }))
      })
    ).toThrow(/unsafe or over-deep folder/);
    expect(() =>
      stage({
        "wiki/index.json": text(JSON.stringify({ files: [], folders: [{ path: "notes:private", sortOrder: 0 }] }))
      })
    ).toThrow(/unsafe or over-deep folder/);
    expect(() =>
      stage({
        "wiki/index.json": text(JSON.stringify({ files: [{ file: "notes:private.md" }], folders: [] }))
      })
    ).toThrow(/unsafe or over-deep file|which the wiki does not hold/);
    expect(() =>
      stage({
        "wiki/page.md": text("# Page"),
        "wiki/index.json": text(
          JSON.stringify({ files: [{ file: "page.md", map: "scenes/not-a-map.png" }], folders: [] })
        )
      })
    ).toThrow(/is not a map/);
    expect(() =>
      stage({
        "maps/undercroft.png": png(),
        "wiki/one.md": text("# One"),
        "wiki/two.md": text("# Two"),
        "wiki/index.json": text(
          JSON.stringify({
            files: [
              { file: "one.md", map: "maps/undercroft.png" },
              { file: "two.md", map: "maps/undercroft.png" }
            ],
            folders: []
          })
        )
      })
    ).toThrow(/more than one page/);
  });

  it("caps every imported Markdown page before application", () => {
    expect(() =>
      refuseUnacceptableEntries(
        [{ ...entry("wiki/too-large.md"), uncompressedSize: WIKI_MARKDOWN_LIMIT_BYTES + 1 }],
        limits
      )
    ).toThrow(/Wiki page/);
  });

  it("measures imported Markdown in UTF-8 bytes at the 256 KiB boundary", () => {
    const exact = "😀".repeat(WIKI_MARKDOWN_LIMIT_BYTES / Buffer.byteLength("😀", "utf8"));
    expect(Buffer.byteLength(exact, "utf8")).toBe(WIKI_MARKDOWN_LIMIT_BYTES);
    expect(() => stage({ "wiki/exact.md": text(exact) })).not.toThrow();
    expect(() => stage({ "wiki/one-byte-too-many.md": text(`${exact}😀`) })).toThrow(/larger than a Wiki page/);
  });
});

describe("wiki campaign round trips", () => {
  it("keeps nested and empty folders, page metadata, legend binding, and importing ownership", () => {
    const result = apply(wikiBundle());
    expect(result.wiki).toEqual({ added: 1, replaced: 0, skipped: 0, unchanged: 0 });

    const page = one<{
      title: string;
      markdown: string;
      visible: number;
      sort_order: number;
      map_media_id: number | null;
      owner_account_id: number | null;
    }>(
      "SELECT title, markdown, visible, sort_order, map_media_id, owner_account_id FROM wiki_pages WHERE room_id = ?",
      roomId
    );
    expect(page).toMatchObject({
      title: "The Duchess",
      markdown: "# Duchess",
      visible: 0,
      sort_order: 7,
      owner_account_id: ACCOUNT
    });
    expect(page?.map_media_id).not.toBeNull();
    expect(
      all<{ name: string; parent: string | null }>(
        `SELECT child.name, parent.name AS parent FROM wiki_folders child
         LEFT JOIN wiki_folders parent ON parent.id = child.parent_id WHERE child.room_id = ? ORDER BY child.name`,
        roomId
      )
    ).toEqual([
      { name: "empty", parent: "unused" },
      { name: "maps", parent: null },
      { name: "unused", parent: null }
    ]);

    const exported = exportRoomCampaign(roomId);
    const files = unzipSync(exported.archive);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["wiki/index.json", "wiki/maps/the-undercroft.md"]));
    const index = JSON.parse(Buffer.from(files["wiki/index.json"]!).toString("utf8"));
    expect(index.folders).toEqual(expect.arrayContaining([{ path: "unused/empty", sortOrder: 9 }]));
    expect(index.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "maps/the-undercroft.md",
          title: "The Duchess",
          visible: false,
          map: "maps/undercroft.png"
        })
      ])
    );

    const second = makeRoom("Destination");
    const archive = path.join(config.dataDir, "wiki-roundtrip.zip");
    fs.writeFileSync(archive, Buffer.from(exported.archive));
    const staged = stageCampaignArchive(archive, {
      roomId: second,
      accountId: ACCOUNT,
      archiveName: exported.filename
    });
    applyCampaign(staged.directory, staged.campaign, second, ACCOUNT, { policy: "skip", takeRoomSettings: false });
    expect(one<{ count: number }>("SELECT COUNT(*) AS count FROM wiki_pages WHERE room_id = ?", second)).toEqual({
      count: 1
    });
    expect(one<{ count: number }>("SELECT COUNT(*) AS count FROM wiki_folders WHERE room_id = ?", second)).toEqual({
      count: 3
    });
  });

  it("uses wiki ledger source and state digests to distinguish unchanged, updated, and room-edited pages", () => {
    expect(apply(wikiBundle("first", "First")).wiki).toEqual({ added: 1, replaced: 0, skipped: 0, unchanged: 0 });
    expect(apply(wikiBundle("first", "First")).wiki).toEqual({ added: 0, replaced: 0, skipped: 0, unchanged: 1 });
    expect(apply(wikiBundle("second", "Second")).wiki).toEqual({ added: 0, replaced: 1, skipped: 0, unchanged: 0 });

    db.prepare("UPDATE wiki_pages SET markdown = 'the room owns this' WHERE room_id = ?").run(roomId);
    expect(apply(wikiBundle("third", "Third")).wiki).toEqual({ added: 0, replaced: 0, skipped: 1, unchanged: 0 });
    expect(one<{ markdown: string }>("SELECT markdown FROM wiki_pages WHERE room_id = ?", roomId)).toEqual({
      markdown: "the room owns this"
    });
  });

  it("rewrites portable targets without touching escaped labels, remints room-item ids, and warns for what cannot travel", () => {
    const source = {
      "maps/undercroft.png": png(),
      "npcs/duchess.json": text(JSON.stringify({ name: "Duchess", notes: "", statblock: { [hitPointsKey]: 4 } })),
      "items/index.json": text(
        JSON.stringify({
          added: [{ key: "duchess-blade", listKey: itemListKey, name: "Duchess Blade", spec: "d6" }],
          retired: []
        })
      ),
      "wiki/maps/undercroft.md": text(
        ":npc[\\[Duchess\\]]{path=npcs/duchess.json} :asset[Map]{path=maps/undercroft.png} " +
          ":item[Blade]{path=items/index.json#duchess-blade} :page[Ledger]{path=wiki/maps/ledger.md} " +
          ":npc[Gone]{path=npcs/gone.json} :pc[Vess]{id=12}"
      ),
      "wiki/maps/ledger.md": text("# Ledger"),
      "wiki/index.json": text(
        JSON.stringify({
          files: [
            { file: "maps/undercroft.md", title: "Undercroft", visible: true, map: "maps/undercroft.png" },
            { file: "maps/ledger.md", title: "Ledger", visible: false }
          ],
          folders: [{ path: "maps", sortOrder: 3 }]
        })
      )
    };
    const first = apply(source);
    expect(first.skipped).toEqual([
      'wiki/maps/undercroft.md: "npcs/gone.json" could not be resolved, so its mention is plain text.'
    ]);
    const sourceItemId = one<{ item_id: string }>("SELECT item_id FROM room_items WHERE room_id = ?", roomId)!.item_id;
    const sourcePage = one<{ markdown: string; id: number }>(
      "SELECT markdown, id FROM wiki_pages WHERE room_id = ? AND slug = 'undercroft'",
      roomId
    )!;
    expect(sourcePage.markdown).toContain(`:npc[\\[Duchess\\]]{id=`);
    expect(sourcePage.markdown).toContain(`:item[Blade]{id=${sourceItemId}}`);
    expect(sourcePage.markdown).toContain(":page[Ledger]{slug=ledger}");
    expect(sourcePage.markdown).toContain("Gone");

    const exported = exportRoomCampaign(roomId);
    expect(exported.warnings).toEqual(['wiki/maps/undercroft.md: PC mention "Vess" was exported as plain text.']);
    const archive = path.join(config.dataDir, "portable-wiki.zip");
    fs.writeFileSync(archive, Buffer.from(exported.archive));
    const exportedFiles = unzipSync(exported.archive);
    const items = JSON.parse(Buffer.from(exportedFiles["items/index.json"]!).toString("utf8"));
    const key = items.added[0].key as string;
    expect(key).toMatch(/^item-[a-f0-9]{20}$/);
    const portable = Buffer.from(exportedFiles["wiki/maps/undercroft.md"]!).toString("utf8");
    expect(portable).toContain(":npc[\\[Duchess\\]]{path=npcs/duchess.json}");
    expect(portable).toContain(`:item[Blade]{path=items/index.json#${key}}`);
    expect(portable).toContain(":page[Ledger]{path=wiki/maps/ledger.md}");
    expect(portable).toContain("Vess");

    const destination = makeRoom("Destination");
    const staged = stageCampaignArchive(archive, {
      roomId: destination,
      accountId: ACCOUNT,
      archiveName: exported.filename
    });
    const result = applyCampaign(staged.directory, staged.campaign, destination, ACCOUNT, {
      policy: "skip",
      takeRoomSettings: false
    });
    expect(result.skipped).toEqual([]);
    const destinationItem = one<{ id: number; item_id: string }>(
      "SELECT id, item_id FROM room_items WHERE room_id = ?",
      destination
    )!;
    expect(destinationItem.item_id).not.toBe(sourceItemId);
    const destinationPage = one<{ id: number; markdown: string }>(
      "SELECT id, markdown FROM wiki_pages WHERE room_id = ? AND slug = 'undercroft'",
      destination
    )!;
    expect(destinationPage.markdown).toContain(`:item[Blade]{id=${destinationItem.item_id}}`);
    expect(
      one<{ item_id: string; room_item_id: number }>(
        "SELECT item_id, room_item_id FROM wiki_mentions WHERE page_id = ? AND kind = 'item'",
        destinationPage.id
      )
    ).toEqual({ item_id: destinationItem.item_id, room_item_id: destinationItem.id });
  });

  it("treats a page moved to another folder as a room edit rather than overwriting it", () => {
    apply(wikiBundle("first", "First"));
    db.prepare("UPDATE wiki_pages SET folder_id = NULL WHERE room_id = ?").run(roomId);
    expect(apply(wikiBundle("first", "First")).wiki).toEqual({ added: 0, replaced: 0, skipped: 1, unchanged: 0 });
  });

  it("quotes portable paths losslessly when a folder name has whitespace and punctuation", () => {
    const folder = Number(
      db
        .prepare("INSERT INTO wiki_folders (room_id, name, sort_order, owner_account_id) VALUES (?, ?, 0, ?)")
        .run(roomId, "Session Notes {braces}", ACCOUNT).lastInsertRowid
    );
    db.prepare(
      `INSERT INTO wiki_pages (room_id, folder_id, slug, title, markdown, visible, sort_order, owner_account_id)
       VALUES (?, ?, 'ledger', 'Ledger', '# Ledger', 0, 0, ?)`
    ).run(roomId, folder, ACCOUNT);
    db.prepare(
      `INSERT INTO wiki_pages (room_id, slug, title, markdown, visible, sort_order, owner_account_id)
       VALUES (?, 'index', 'Index', ':page[Ledger]{slug=ledger}', 0, 0, ?)`
    ).run(roomId, ACCOUNT);

    const exported = exportRoomCampaign(roomId);
    const files = unzipSync(exported.archive);
    const index = JSON.parse(Buffer.from(files["wiki/index.json"]!).toString("utf8"));
    const ledger = index.files.find((entry: { title: string }) => entry.title === "Ledger") as { file: string };
    const portable = Buffer.from(files["wiki/index.md"]!).toString("utf8");
    expect(campaignWikiDirectives(portable, "path")).toEqual([
      expect.objectContaining({ target: `wiki/${ledger.file}` })
    ]);

    const destination = makeRoom("Quoted destination");
    const archive = path.join(config.dataDir, "quoted-wiki.zip");
    fs.writeFileSync(archive, Buffer.from(exported.archive));
    const staged = stageCampaignArchive(archive, {
      roomId: destination,
      accountId: ACCOUNT,
      archiveName: exported.filename
    });
    applyCampaign(staged.directory, staged.campaign, destination, ACCOUNT, { policy: "skip", takeRoomSettings: false });
    expect(
      one<{ markdown: string }>("SELECT markdown FROM wiki_pages WHERE room_id = ? AND slug = 'index'", destination)
        ?.markdown
    ).toContain(":page[Ledger]{slug=ledger}");
  });

  it("serializes whitespace, quotes, braces, and backslashes as one remark-safe path attribute", () => {
    const source = campaignWikiDirectives(":page[Ledger]{slug=ledger}", "slug")[0]!;
    const serialized = withCampaignWikiDirectiveTarget(source, "path", 'wiki/Session Notes/"{a}\\ledger.md');
    expect(campaignWikiDirectives(serialized, "path")).toEqual([
      expect.objectContaining({ target: 'wiki/Session Notes/"{a}\\ledger.md' })
    ]);
  });

  it("does not merge imported folders into another account's hierarchy or rewrite its order", () => {
    db.prepare(
      "INSERT INTO accounts (id, username, password_hash, is_admin, account_role) VALUES (2, 'Other', '', 0, 'gm')"
    ).run();
    db.prepare("INSERT INTO wiki_folders (room_id, name, sort_order, owner_account_id) VALUES (?, 'maps', 44, 2)").run(
      roomId
    );
    expect(() => apply(wikiBundle())).toThrow(/owned by another account/);
    expect(
      one<{ sort_order: number }>("SELECT sort_order FROM wiki_folders WHERE room_id = ? AND name = 'maps'", roomId)
    ).toEqual({
      sort_order: 44
    });
  });

  it("refuses to export a legacy unsafe folder name instead of writing a traversal-shaped archive", () => {
    db.prepare("INSERT INTO wiki_folders (room_id, name, sort_order, owner_account_id) VALUES (?, '..', 0, ?)").run(
      roomId,
      ACCOUNT
    );
    expect(() => exportRoomCampaign(roomId)).toThrow(/cannot be represented safely/);
  });

  it("exports version 2 while retaining compatibility with a version 1 bundle", () => {
    const exported = JSON.parse(
      Buffer.from(unzipSync(exportRoomCampaign(roomId).archive)["manifest.json"]!).toString("utf8")
    );
    expect(exported.bundleVersion).toBe(CAMPAIGN_BUNDLE_VERSION);
    expect(
      apply({
        "manifest.json": text(
          JSON.stringify({
            app: "devils-toys-campaign",
            bundleVersion: 1,
            campaignId: "old",
            name: "Old",
            system: "toybox"
          })
        )
      }).wiki
    ).toEqual({ added: 0, replaced: 0, skipped: 0, unchanged: 0 });
  });

  it("uses a first Markdown heading as a legacy page title when no index names it", () => {
    apply({ "wiki/mysterious-file.md": text("## The Actual Title") });
    expect(one<{ title: string }>("SELECT title FROM wiki_pages WHERE room_id = ?", roomId)).toEqual({
      title: "The Actual Title"
    });
  });
});
