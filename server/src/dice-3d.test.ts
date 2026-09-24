import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_DICE_PREFERENCES, DICE_SHAPES, diceGeometry, type CustomDie } from "@devils-toys/shared";
import { rollDice, rollCustomDie } from "./dice.js";
import { gameSystemSchema } from "./system-schema.js";
import { installToybox, toyboxDefinition } from "./test-fixture.js";
import { readSystemRepoDirectory } from "./system-repo.js";
import { projectFile } from "./paths.js";
import { buildSystemBundle, readSystemBundle } from "./system-bundles.js";
import { systemContentFor, writeSystemBundle } from "./system-install.js";
import { db } from "./db.js";
import { dicePreferencesSchema, presentDice, readDicePreferences } from "./dice-3d.js";
import { broadcastRoom, sendToRoomAccount, sendToRoomGms } from "./realtime.js";
vi.mock("./realtime.js", () => ({ broadcastRoom: vi.fn(), sendToRoomAccount: vi.fn(), sendToRoomGms: vi.fn() }));

describe("roll presentations", () => {
  for (const sides of DICE_SHAPES)
    it(`preserves d${sides} results and face indexes`, () => {
      for (let n = 0; n < sides; n++) {
        const rolled = rollDice(`d${sides}`, () => (n + 0.5) / sides);
        expect(rolled.total).toBe(n + 1);
        expect(rolled.dice[0]).toMatchObject({ shape: sides, face: n, value: n + 1 });
      }
    });
  it("distinguishes tied kept and dropped dice by identity", () => {
    const result = rollDice("3d6kh1+2", () => 0.4);
    expect(result.dice.map((die) => die.kept)).toEqual([true, false, false]);
    expect(result.total).toBe(5);
  });
  it("maps every percentile result including 100, 10 and 1", () => {
    for (let n = 1; n <= 100; n++) {
      const result = rollDice("d100", () => (n - 0.5) / 100);
      const [tens, units] = result.dice;
      expect(tens.value + units.value || 100).toBe(n);
      expect(tens.labels![tens.face]).toBe(tens.value);
      expect(units.labels![units.face]).toBe(units.value);
    }
    expect(rollDice("d%", () => 0.999).total).toBe(100);
    expect(rollDice("d%10", () => 0.999).total).toBe(90);
    expect(rollDice("d%10", () => 0).total).toBe(0);
  });
  it("preserves compound tens/units and drop decisions", () => {
    for (const sides of [44, 66]) {
      const result = rollDice(`2d${sides}kl1`, () => 0);
      expect(result.rolls).toEqual([11, 11]);
      expect(result.dice.map((die) => [die.value, die.role, die.kept])).toEqual([
        [1, "tens", true],
        [1, "units", true],
        [1, "tens", false],
        [1, "units", false]
      ]);
    }
  });
});

describe("custom numeric dice installation", () => {
  beforeAll(() => installToybox());
  const validate = (die: unknown) =>
    gameSystemSchema.safeParse({ ...toyboxDefinition(), dice3d: { version: 1, dice: [die] } });
  it("installs and exports custom definitions through the real bundle path", () => {
    const content = systemContentFor("toybox");
    const read = readSystemBundle(buildSystemBundle(content));
    expect(read.system.dice3d).toEqual(content.system.dice3d);
    writeSystemBundle(read);
    expect(systemContentFor("toybox").system.dice3d).toEqual(content.system.dice3d);
    expect(readSystemRepoDirectory(projectFile("fixtures", "plainbox")).system.dice3d).toBeUndefined();
  });
  it("selects faces uniformly, retaining repeated numeric values", () => {
    const die: CustomDie = { id: "fate", name: "Fate", shape: 6, values: [-1, -1, 0, 0, 1, 1] };
    expect(validate(die).success).toBe(true);
    for (let face = 0; face < 6; face++)
      expect(rollCustomDie("toybox", die, 1, () => (face + 0.5) / 6).dice[0]).toMatchObject({
        definition: "toybox:fate",
        face,
        value: die.values[face]
      });
  });
  it("checks authored convex geometry and complete stable result mappings", () => {
    const die = {
      id: "cube",
      name: "Cube",
      geometry: diceGeometry(6),
      resultFaces: [0, 1, 2, 3, 4, 5],
      values: [1, 2, 3, 4, 5, 6]
    };
    expect(validate(die).success).toBe(true);
    expect(validate({ ...die, resultFaces: [0, 0, 2, 3, 4, 5] }).success).toBe(false);
    expect(validate({ ...die, geometry: { ...die.geometry, faces: die.geometry.faces.slice(1) } }).success).toBe(false);
    expect(validate({ ...die, script: "alert(1)" }).success).toBe(false);
    expect(validate({ ...die, values: [1] }).success).toBe(false);
    expect(validate({ id: "bad", name: "Bad", shape: 7, values: [1, 2] }).success).toBe(false);
  });
});

describe("audience and preference boundaries", () => {
  beforeAll(() => {
    installToybox();
    db.prepare("INSERT INTO accounts (id,username,password_hash) VALUES (920,'dice-test','unused')").run();
    db.prepare("INSERT INTO rooms (id,name,system,theme,created_by) VALUES (920,'Dice','toybox','digital',920)").run();
  });
  it("defaults rooms off and personal animation on; disabling does not erase appearance", () => {
    expect(readDicePreferences(920).enabled).toBe(true);
    expect(presentDice(920, 920, rollDice("d6"), "room")).toEqual([]);
    expect(dicePreferencesSchema.safeParse(DEFAULT_DICE_PREFERENCES).success).toBe(true);
    db.prepare("INSERT INTO dice_preferences VALUES (?,?)").run(
      920,
      JSON.stringify({ ...DEFAULT_DICE_PREFERENCES, enabled: false, theme: "grim" })
    );
    db.prepare("UPDATE rooms SET dice_3d_enabled=1 WHERE id=920").run();
    const [animation] = presentDice(920, 920, rollDice("d6"), "room");
    expect(animation.appearance.body).toBe("#e4e0d7");
    expect(readDicePreferences(920).enabled).toBe(false);
  });
  it("routes result metadata only to the explicit audience", () => {
    for (const audience of ["room", "roller", "roller-and-gms"] as const) {
      vi.clearAllMocks();
      presentDice(920, 920, rollDice("d20"), audience);
      expect(vi.mocked(broadcastRoom).mock.calls.length).toBe(audience === "room" ? 1 : 0);
      expect(vi.mocked(sendToRoomGms).mock.calls.length).toBe(audience === "roller-and-gms" ? 1 : 0);
      expect(vi.mocked(sendToRoomAccount).mock.calls.length).toBe(audience === "room" ? 0 : 1);
    }
  });
});
