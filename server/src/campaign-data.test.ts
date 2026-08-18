import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { applyCampaign, type ApplyOptions } from "./campaign-apply.js";
import { stageCampaignArchive, type StagedCampaign } from "./campaign-staging.js";
import { config } from "./config.js";
import { all, db, one } from "./db.js";
import { applyRoomOverlay, retiredIds } from "./room-items.js";
import { readItemCatalog } from "./item-catalog.js";
import { groupAssetDefinitions } from "@devils-toys/shared";
import { installToybox } from "./test-fixture.js";

const toybox = installToybox();

let roomId = 0;
const ACCOUNT = 1;

beforeEach(() => {
  db.exec(
    `DELETE FROM table_sets; DELETE FROM group_obligations; DELETE FROM group_assets; DELETE FROM group_hirelings;
     DELETE FROM room_retired_items; DELETE FROM room_items; DELETE FROM custom_npcs;
     DELETE FROM media; DELETE FROM memberships; DELETE FROM rooms; DELETE FROM accounts;`
  );
  db.prepare(
    "INSERT INTO accounts (id, username, password_hash, is_admin, account_role) VALUES (?, ?, '', 1, 'admin')"
  ).run(ACCOUNT, "Admin");
  roomId = Number(
    db
      .prepare("INSERT INTO rooms (name, system, theme, created_by) VALUES ('The Tomb', 'toybox', 'grim', ?)")
      .run(ACCOUNT).lastInsertRowid
  );
});

/** Bytes pass through; everything else is the JSON a bundle would carry. */
const text = (value: unknown) =>
  Buffer.isBuffer(value) || value instanceof Uint8Array
    ? new Uint8Array(value)
    : new Uint8Array(Buffer.from(typeof value === "string" ? value : JSON.stringify(value)));

function stage(files: Record<string, unknown>): StagedCampaign {
  const archive = path.join(config.dataDir, `${Math.random().toString(36).slice(2)}.zip`);
  fs.writeFileSync(
    archive,
    zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, text(v)])), {
      level: 6
    })
  );
  return stageCampaignArchive(archive, { roomId, accountId: ACCOUNT, archiveName: "tomb.devilcampaign.zip" });
}

const apply = (files: Record<string, unknown>, options: Partial<ApplyOptions> = {}) => {
  const staged = stage(files);
  return applyCampaign(staged.directory, staged.campaign, roomId, ACCOUNT, {
    policy: "skip",
    takeRoomSettings: false,
    ...options
  });
};

/** The first statblock field the fixture declares, so the tests use a real one. */
const statField = toybox.npcStatblock.fields[0];
const listKey = toybox.characterSheet.lists[0].key;

describe("the room's cast", () => {
  it("writes an NPC with the statblock its system declares", () => {
    const result = apply({
      "npcs/lady-vane.json": {
        name: "Lady Vane",
        notes: "Not to be trusted.",
        statblock: { [statField.key]: statField.kind === "number" ? 3 : "3" }
      }
    });

    expect(result.npcs).toEqual({ added: 1, replaced: 0, skipped: 0 });
    const npc = one<{ name: string; notes: string; statblock_json: string }>(
      "SELECT name, notes, statblock_json FROM custom_npcs WHERE room_id = ?",
      roomId
    )!;
    expect(npc.name).toBe("Lady Vane");
    expect(JSON.parse(npc.statblock_json)).toHaveProperty(statField.key);
  });

  /**
   * A field the room's system does not declare would be one nothing ever renders.
   * Refusing the whole import over it would be worse than landing an NPC that is
   * mostly right, so the field goes and the loss is said out loud.
   */
  it("drops a statblock field this system has never heard of, and says so", () => {
    const result = apply({
      "npcs/vane.json": {
        name: "Vane",
        statblock: { [statField.key]: statField.kind === "number" ? 3 : "3", wingspan: 12 }
      }
    });

    expect(result.npcs.added).toBe(1);
    expect(result.skipped[0]).toMatch(/npcs\/vane\.json:.*[Uu]nknown NPC statblock field/);
    const npc = one<{ statblock_json: string }>("SELECT statblock_json FROM custom_npcs WHERE room_id = ?", roomId)!;
    expect(JSON.parse(npc.statblock_json)).not.toHaveProperty("wingspan");
    expect(JSON.parse(npc.statblock_json)).toHaveProperty(statField.key);
  });

  it("skips or replaces an NPC of the same name, as the policy says", () => {
    apply({ "npcs/vane.json": { name: "Vane", notes: "First." } });

    expect(apply({ "npcs/vane.json": { name: "vane", notes: "Second." } }).npcs).toEqual({
      added: 0,
      replaced: 0,
      skipped: 1
    });
    expect(one<{ notes: string }>("SELECT notes FROM custom_npcs WHERE room_id = ?", roomId)!.notes).toBe("First.");

    expect(apply({ "npcs/vane.json": { name: "Vane", notes: "Third." } }, { policy: "replace" }).npcs).toEqual({
      added: 0,
      replaced: 1,
      skipped: 0
    });
    expect(one<{ notes: string }>("SELECT notes FROM custom_npcs WHERE room_id = ?", roomId)!.notes).toBe("Third.");
  });
});

describe("the room's gear", () => {
  it("mints an added item against the room that will hold it", () => {
    const result = apply({
      "items/index.json": { added: [{ listKey, name: "Serpent Blade", spec: "d8", cost: "20gp" }] }
    });

    expect(result.items).toEqual({ added: 1, replaced: 0, skipped: 0 });
    const row = one<{ item_id: string; list_key: string }>(
      "SELECT item_id, list_key FROM room_items WHERE room_id = ?",
      roomId
    )!;
    // `room:<roomId>:<slug>` — an id carried over from the bundle would name a
    // room that is not this one.
    expect(row.item_id).toBe(`room:${roomId}:serpent-blade--d8`);
    expect(row.list_key).toBe(listKey);
    expect(applyRoomOverlay(readItemCatalog("toybox").lists, roomId)[listKey].at(-1)?.name).toBe("Serpent Blade");
  });

  it("refuses an item for a list this system has not got, and lands the rest", () => {
    const result = apply({
      "items/index.json": {
        added: [
          { listKey, name: "Serpent Blade" },
          { listKey: "trinkets", name: "A Bad Idea" }
        ]
      }
    });

    expect(result.items).toEqual({ added: 1, replaced: 0, skipped: 1 });
    expect(result.skipped[0]).toMatch(
      /"A Bad Idea" belongs to a list called "trinkets", which this system has not got/
    );
  });

  it("retires an id the system's catalogue actually has", () => {
    const known = Object.values(readItemCatalog("toybox").lists).flat()[0]!;
    const result = apply({ "items/index.json": { retired: [known.id, "toybox/not-a-real-item"] } });

    expect(retiredIds(roomId)).toEqual([known.id]);
    expect(result.skipped[0]).toMatch(/retires "toybox\/not-a-real-item", which this system's catalogue has not got/);
  });
});

describe("the party's own things", () => {
  it("writes hirelings, shared property, and what is owed", () => {
    // Through the same resolver the group page uses: the fixture declares its
    // ship as a starshipSheet, and reading groupAssets directly would quietly
    // skip the asset and leave this test passing without covering it.
    const assetKind = groupAssetDefinitions(toybox.groupPage)[0]?.kind;
    const result = apply({
      "hirelings/brann.json": { name: "Brann", sheet: { role: "Torchbearer" } },
      ...(assetKind ? { "assets/kestrel.json": { name: "The Kestrel", kind: assetKind } } : {}),
      "obligations/the-baron.json": { name: "The Baron's loan", owedTo: "The Baron", amount: "500gp" }
    });

    // The fixture does declare shared property, so this covers the asset write
    // rather than quietly counting two.
    expect(assetKind).toBeTruthy();
    expect(result.group.added).toBe(3);
    expect(all("SELECT kind FROM group_assets WHERE room_id = ?", roomId)).toEqual([{ kind: assetKind }]);
    expect(all("SELECT id FROM group_hirelings WHERE room_id = ?", roomId)).toHaveLength(1);
    expect(
      one<{ owed_to: string; amount: string }>(
        "SELECT owed_to, amount FROM group_obligations WHERE room_id = ?",
        roomId
      )
    ).toMatchObject({ owed_to: "The Baron", amount: "500gp" });
  });

  /**
   * A system with no shared property has nowhere to put a starship. Writing the
   * row anyway would be a silent loss, and refusing the import would cost the GM
   * everything else in the bundle — so it is named, and the rest lands.
   */
  it("refuses a kind of shared property this system has not got, by name", () => {
    const result = apply({
      "hirelings/brann.json": { name: "Brann" },
      "assets/kestrel.json": { name: "The Kestrel", kind: "zeppelin" }
    });

    expect(result.skipped).toEqual([
      expect.stringMatching(/assets\/kestrel\.json: this system has no shared property of the kind "zeppelin"/)
    ]);
    expect(all("SELECT id FROM group_assets WHERE room_id = ?", roomId)).toHaveLength(0);
    expect(all("SELECT id FROM group_hirelings WHERE room_id = ?", roomId)).toHaveLength(1);
  });
});

describe("the campaign's calendar", () => {
  const calendar = {
    year: 812,
    month: 2,
    day: 14,
    daysPerWeek: 7,
    daysPerMonth: 30,
    dayNames: ["Moonday", "Toilday"],
    monthNames: ["Frost", "Thaw", "Green"],
    segmentsPerDay: 2,
    segment: 0,
    segmentNames: ["Day", "Night"],
    events: [{ id: "fair", name: "The Fair", cadence: "holiday", day: 3, month: 1 }]
  };

  it("is taken only when the room's settings are, and switches the calendar on", () => {
    apply({ "calendar.json": calendar });
    expect(
      one<{ calendar_enabled: number }>("SELECT calendar_enabled FROM rooms WHERE id = ?", roomId)!.calendar_enabled
    ).toBe(0);

    const result = apply({ "calendar.json": calendar }, { takeRoomSettings: true });
    const row = one<{ calendar_enabled: number; calendar_json: string }>(
      "SELECT calendar_enabled, calendar_json FROM rooms WHERE id = ?",
      roomId
    )!;
    expect(row.calendar_enabled).toBe(1);
    expect(JSON.parse(row.calendar_json).monthNames).toEqual(["Frost", "Thaw", "Green"]);
    expect(result.room).toContain("calendar taken from the campaign");
  });

  it("refuses a calendar that is not one, by name", () => {
    expect(() => apply({ "calendar.json": { year: "eight hundred" } })).toThrow();
  });
});

describe("the pictures a hireling or a ship carries", () => {
  const png = () => {
    const body = Buffer.alloc(64, 3);
    Buffer.from("89504e470d0a1a0a", "hex").copy(body);
    return body;
  };

  it("writes a portrait onto the row that names it", () => {
    const staged = stage({
      "hirelings/brann.json": { name: "Brann", portrait: "hirelings/brann.png" },
      "hirelings/brann.png": png()
    });
    applyCampaign(staged.directory, staged.campaign, roomId, ACCOUNT, { policy: "skip", takeRoomSettings: false });

    const row = one<{ portrait_filename: string; portrait_stored_name: string; portrait_size: number }>(
      "SELECT portrait_filename, portrait_stored_name, portrait_mime_type, portrait_size FROM group_hirelings WHERE room_id = ?",
      roomId
    )!;
    expect(row.portrait_filename).toBe("brann.png");
    expect(row.portrait_size).toBe(64);
    expect(fs.existsSync(path.join(config.dataDir, "uploads", row.portrait_stored_name))).toBe(true);
  });

  /**
   * An image nothing names is an image nothing imports. Saying so is the whole
   * difference between a bundle that lost a picture and a bundle that told you.
   */
  it("says so when an image in the folder is not worn by anything", () => {
    const staged = stage({ "hirelings/brann.json": { name: "Brann" }, "hirelings/stray.png": png() });
    expect(staged.campaign.warnings).toContain(
      "hirelings/stray.png is not named as a portrait, so nothing imports it."
    );
  });

  it("refuses a portrait the bundle does not contain", () => {
    expect(() => stage({ "hirelings/brann.json": { name: "Brann", portrait: "hirelings/missing.png" } })).toThrow(
      /names "hirelings\/missing\.png", which the bundle does not contain/
    );
  });

  it("refuses a portrait that is not the image it claims to be", () => {
    const staged = stage({
      "assets/kestrel.json": { name: "The Kestrel", kind: "starship", portrait: "assets/kestrel.png" },
      "assets/kestrel.png": "not a PNG at all"
    });
    expect(() =>
      applyCampaign(staged.directory, staged.campaign, roomId, ACCOUNT, { policy: "skip", takeRoomSettings: false })
    ).toThrow(/"assets\/kestrel\.png" is not an image this application stores/);
  });
});

describe("a campaign's random tables", () => {
  const png = () => {
    const body = Buffer.alloc(64, 5);
    Buffer.from("89504e470d0a1a0a", "hex").copy(body);
    return body;
  };
  const set = (name = "Rumours") =>
    JSON.stringify({
      formatVersion: 1,
      tables: [
        {
          name,
          dice: "d6",
          columns: ["Roll", "Rumour"],
          rows: [
            { label: "1-3", min: 1, max: 3, cells: ["The tomb moves."] },
            { label: "4-6", min: 4, max: 6, cells: ["It does not."] }
          ]
        }
      ]
    });

  const manifest = (name: string) =>
    JSON.stringify({ app: "devils-toys-campaign", bundleVersion: 1, campaignId: "tomb", name, system: "toybox" });

  const sets = () => all<{ name: string; markdown: string }>("SELECT name, markdown FROM table_sets ORDER BY id");

  /**
   * `table_sets` has no room. A set added by anybody is readable from every room
   * on the server, so an imported one is named for the campaign it came from
   * rather than dropped into the catalogue under a name like "Rumours".
   */
  it("names the set for the campaign it came from", () => {
    const result = apply({
      "manifest.json": manifest("Tomb of the Serpent Kings"),
      "tables/rumours.json": set()
    });

    expect(result.tables).toEqual({ added: 1, replaced: 0, skipped: 0 });
    expect(sets()[0].name).toBe("Tomb of the Serpent Kings — rumours");
    // Markdown stays the source of truth, as it is for every other set.
    expect(sets()[0].markdown).toMatch(/The tomb moves\./);
  });

  it("skips or replaces a set of the same name, as the policy says", () => {
    apply({ "manifest.json": manifest("Tomb"), "tables/rumours.json": set("Rumours") });
    expect(apply({ "manifest.json": manifest("Tomb"), "tables/rumours.json": set("Omens") }).tables).toEqual({
      added: 0,
      replaced: 0,
      skipped: 1
    });
    expect(sets()).toHaveLength(1);
    expect(sets()[0].markdown).toMatch(/Rumours/);

    expect(
      apply({ "manifest.json": manifest("Tomb"), "tables/rumours.json": set("Omens") }, { policy: "replace" }).tables
    ).toEqual({ added: 0, replaced: 1, skipped: 0 });
    expect(sets()[0].markdown).toMatch(/Omens/);
  });

  /**
   * The standing rule is that an unknown tag is refused rather than dropped. It
   * costs the set rather than the campaign, because a tag this server has not
   * heard of says nothing about the forty maps in the same bundle.
   */
  it("refuses a set carrying a tag this instance has not got, and lands the rest", () => {
    const tagged = JSON.parse(set()) as { tables: { tags?: string[] }[] };
    tagged.tables[0].tags = ["not-a-real-tag"];

    const result = apply({
      "manifest.json": manifest("Tomb"),
      "maps/keep.png": png(),
      "tables/rumours.json": JSON.stringify(tagged)
    });

    expect(result.tables).toEqual({ added: 0, replaced: 0, skipped: 1 });
    expect(result.skipped[0]).toMatch(/tables\/rumours\.json: Unknown table tag "not-a-real-tag"/);
    expect(sets()).toHaveLength(0);
    // The map still landed: one bad tag does not cost a campaign its library.
    expect(result.media.added).toBe(1);
  });

  it("keeps the tags this instance does know", () => {
    const known = one<{ slug: string }>("SELECT slug FROM table_tags LIMIT 1")!.slug;
    const tagged = JSON.parse(set()) as { tags?: string[] };
    tagged.tags = [known, "not-in-the-vocabulary"];

    apply({ "manifest.json": manifest("Tomb"), "tables/rumours.json": JSON.stringify(tagged) });
    expect(JSON.parse(one<{ tags_json: string }>("SELECT tags_json FROM table_sets")!.tags_json)).toEqual([known]);
  });
});
