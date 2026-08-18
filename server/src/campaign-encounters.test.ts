import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { applyCampaign, type ApplyOptions } from "./campaign-apply.js";
import { stageCampaignArchive, type StagedCampaign } from "./campaign-staging.js";
import { config } from "./config.js";
import { all, db, one } from "./db.js";
import { installToybox } from "./test-fixture.js";

const toybox = installToybox();

let roomId = 0;
const ACCOUNT = 1;
const sides = toybox.initiative.sides ?? [];
const enemySide = sides.find((side) => side.id === "enemies")?.id ?? sides[0]?.id ?? "enemies";
const partySide = sides.find((side) => side.id === "party")?.id ?? sides[0]?.id ?? "party";
const hpKey = toybox.npcStatblock.hitPointsKey;

beforeEach(() => {
  db.exec(
    `DELETE FROM encounter_combatants; DELETE FROM encounter_zones; DELETE FROM encounter_sides;
     DELETE FROM encounters; DELETE FROM group_hirelings; DELETE FROM custom_npcs;
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

const png = () => {
  const body = Buffer.alloc(64, 4);
  Buffer.from("89504e470d0a1a0a", "hex").copy(body);
  return body;
};
const bytes = (value: unknown) =>
  Buffer.isBuffer(value) || value instanceof Uint8Array
    ? new Uint8Array(value)
    : new Uint8Array(Buffer.from(typeof value === "string" ? value : JSON.stringify(value)));

function stage(files: Record<string, unknown>): StagedCampaign {
  const archive = path.join(config.dataDir, `${Math.random().toString(36).slice(2)}.zip`);
  fs.writeFileSync(
    archive,
    zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, bytes(v)])), { level: 6 })
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

/** A campaign whose encounter points at all three of the things one can point at. */
const fullBundle = (over: Record<string, unknown> = {}) => ({
  "maps/the-keep.png": png(),
  "npcs/lady-vane.json": { name: "Lady Vane", statblock: { [hpKey]: 8 } },
  "hirelings/brann.json": { name: "Brann" },
  "encounters/the-gate.json": {
    name: "The Gate",
    notes: "They are expected.",
    map: "maps/the-keep.png",
    zones: ["Gatehouse", "Courtyard"],
    sides: [{ side: enemySide, initiative: 12 }],
    combatants: [
      { npc: "npcs/lady-vane.json", side: enemySide, zone: "Gatehouse", sortOrder: 0 },
      { hireling: "hirelings/brann.json", side: partySide, sortOrder: 1 }
    ]
  },
  ...over
});

const encounterRow = () =>
  one<{ id: number; name: string; active: number; media_id: number | null; notes: string }>(
    "SELECT id, name, active, media_id, notes FROM encounters WHERE room_id = ?",
    roomId
  )!;

describe("a prepared encounter", () => {
  it("resolves its map, its NPCs, and its hirelings to the rows they became", () => {
    const result = apply(fullBundle());
    expect(result.encounters).toEqual({ added: 1, replaced: 0, skipped: 0, unchanged: 0 });

    const encounter = encounterRow();
    expect(encounter.name).toBe("The Gate");
    const map = one<{ id: number }>("SELECT id FROM media WHERE room_id = ? AND filename = 'the-keep.png'", roomId)!;
    expect(encounter.media_id).toBe(map.id);

    const combatants = all<{ kind: string; name: string; npc_id: number | null; hireling_id: number | null }>(
      "SELECT kind, name, npc_id, hireling_id FROM encounter_combatants WHERE encounter_id = ? ORDER BY sort_order",
      encounter.id
    );
    const npc = one<{ id: number }>("SELECT id FROM custom_npcs WHERE room_id = ?", roomId)!;
    const hireling = one<{ id: number }>("SELECT id FROM group_hirelings WHERE room_id = ?", roomId)!;
    expect(combatants).toEqual([
      { kind: "npc", name: "Lady Vane", npc_id: npc.id, hireling_id: null },
      { kind: "hireling", name: "Brann", npc_id: null, hireling_id: hireling.id }
    ]);
  });

  /**
   * A bundle landing mid-session must not put a fight on everybody's screen.
   * Starting one is the GM's own act.
   */
  it("is never running when it arrives", () => {
    apply(fullBundle());
    expect(encounterRow().active).toBe(0);
  });

  it("takes its hit points from the key the system declares", () => {
    apply(fullBundle());
    const combatant = one<{ hp_current: number; hp_max: number; statblock_json: string }>(
      "SELECT hp_current, hp_max, statblock_json FROM encounter_combatants WHERE kind = 'npc'"
    )!;
    expect(combatant.hp_current).toBe(8);
    expect(combatant.hp_max).toBe(8);
    expect(JSON.parse(combatant.statblock_json)[hpKey]).toBe(8);
  });

  it("writes its zones in order and puts a combatant in the one it named", () => {
    apply(fullBundle());
    const zones = all<{ id: number; name: string }>(
      "SELECT id, name FROM encounter_zones WHERE encounter_id = ? ORDER BY sort_order",
      encounterRow().id
    );
    expect(zones.map((zone) => zone.name)).toEqual(["Gatehouse", "Courtyard"]);
    expect(one<{ zone_id: number }>("SELECT zone_id FROM encounter_combatants WHERE kind = 'npc'")!.zone_id).toBe(
      zones[0].id
    );
  });

  it("gives every side the system declares, carrying the initiative the campaign stated", () => {
    apply(fullBundle());
    const rows = all<{ side: string; initiative: number | null }>(
      "SELECT side, initiative FROM encounter_sides WHERE encounter_id = ?",
      encounterRow().id
    );
    expect(rows.map((row) => row.side).sort()).toEqual(sides.map((side) => side.id).sort());
    expect(rows.find((row) => row.side === enemySide)!.initiative).toBe(12);
  });
});

describe("what an encounter's references have to resolve to", () => {
  it("refuses a map the bundle does not carry", () => {
    expect(() => stage({ "encounters/gate.json": { name: "The Gate", map: "maps/missing.png" } })).toThrow(
      /names "maps\/missing\.png", which the bundle does not contain as a map or a scene/
    );
  });

  it("refuses a combatant naming an NPC the bundle does not carry", () => {
    expect(() =>
      stage({ "encounters/gate.json": { name: "The Gate", combatants: [{ npc: "npcs/nobody.json" }] } })
    ).toThrow(/names "npcs\/nobody\.json", which the bundle does not contain/);
  });

  it("refuses a combatant that is neither one NPC nor one hireling", () => {
    expect(() =>
      stage({
        "npcs/vane.json": { name: "Vane" },
        "hirelings/brann.json": { name: "Brann" },
        "encounters/gate.json": {
          name: "The Gate",
          combatants: [{ npc: "npcs/vane.json", hireling: "hirelings/brann.json" }]
        }
      })
    ).toThrow(/a combatant that is neither one NPC nor one hireling/);
    expect(() => stage({ "encounters/gate.json": { name: "The Gate", combatants: [{ sortOrder: 0 }] } })).toThrow(
      /neither one NPC nor one hireling/
    );
  });

  it("refuses a zone the encounter does not declare", () => {
    expect(() =>
      stage({
        "npcs/vane.json": { name: "Vane" },
        "encounters/gate.json": {
          name: "The Gate",
          zones: ["Gatehouse"],
          combatants: [{ npc: "npcs/vane.json", zone: "The Cellar" }]
        }
      })
    ).toThrow(/names the zone "The Cellar", which it does not declare/);
  });
});

describe("what an encounter does about what is already there", () => {
  /**
   * An encounter in progress carries hit points, initiative, and positions that a
   * re-import cannot know about. Replacing one mid-fight would be the worst thing
   * this importer could do, so it never does.
   */
  it("never replaces an encounter of the same name, whatever the policy says", () => {
    apply(fullBundle());
    for (const policy of ["skip", "replace", "add"] as const) {
      const result = apply(fullBundle(), { policy });
      expect(result.encounters).toEqual({ added: 0, replaced: 0, skipped: 1, unchanged: 0 });
      expect(result.skipped.some((line) => /already has an encounter called "The Gate"/.test(line))).toBe(true);
    }
    expect(all("SELECT id FROM encounters WHERE room_id = ?", roomId)).toHaveLength(1);
  });

  /**
   * The reader refuses a path the bundle does not hold, so a combatant can only
   * go missing when an earlier writer left its thing out — a hireling in a system
   * that has none. The fixture does have hirelings, so this stands one up without
   * them for the length of the test rather than leaving the branch unexercised.
   */
  it("drops a combatant whose hireling this system could not hold, and says so", () => {
    const hirelings = toybox.groupPage?.hirelings;
    delete (toybox.groupPage as { hirelings?: unknown }).hirelings;
    try {
      const result = apply({
        "npcs/vane.json": { name: "Vane", statblock: { [hpKey]: 4 } },
        "hirelings/ghost.json": { name: "Ghost" },
        "encounters/gate.json": {
          name: "The Gate",
          combatants: [{ npc: "npcs/vane.json" }, { hireling: "hirelings/ghost.json" }]
        }
      });

      expect(result.group.skipped).toBe(1);
      expect(result.encounters.added).toBe(1);
      expect(result.skipped).toContain(
        'encounters/gate.json: "hirelings/ghost.json" was not imported, so it is not in the fight.'
      );
      // The NPC is still in the fight: one combatant lost is not the whole thing.
      const combatants = all<{ kind: string }>("SELECT kind FROM encounter_combatants");
      expect(combatants).toEqual([{ kind: "npc" }]);
    } finally {
      if (hirelings) (toybox.groupPage as { hirelings?: unknown }).hirelings = hirelings;
    }
  });

  it("names a side this system has not got rather than writing it", () => {
    const result = apply({
      "npcs/vane.json": { name: "Vane" },
      "encounters/gate.json": {
        name: "The Gate",
        sides: [{ side: "spectators", initiative: 3 }],
        combatants: [{ npc: "npcs/vane.json", side: "spectators" }]
      }
    });

    expect(result.skipped.filter((line) => /no side called "spectators"/.test(line))).toHaveLength(2);
    expect(all("SELECT id FROM encounter_combatants")).toHaveLength(0);
    expect(
      all<{ side: string }>("SELECT side FROM encounter_sides WHERE encounter_id = ?", encounterRow().id).map(
        (row) => row.side
      )
    ).not.toContain("spectators");
  });
});
