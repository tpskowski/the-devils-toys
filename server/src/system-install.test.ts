import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { builtinSystems } from "./builtin-systems.js";
import { buildSystemBundle, readSystemBundle, renameSystem } from "./system-bundles.js";
import {
  installedSystemIds,
  refuseUninstallableBundle,
  systemContentFor,
  writeSystemBundle
} from "./system-install.js";
import { installedSystemRoot } from "./system-content.js";
import { installToybox } from "./test-fixture.js";

installToybox();

const bundleFor = (id: string, as = `${id}-2`) =>
  readSystemBundle(buildSystemBundle(renameSystem(systemContentFor(id), as)));

/** A readable bundle whose definition can be bent one way at a time. */
const bent = (change: (system: Record<string, never>) => void) => {
  const bundle = bundleFor("toybox");
  change(bundle.system as never);
  return bundle;
};

describe("what a bundle has to be true of to install", () => {
  // The check has to pass a real system before it may reject anything: a rule
  // the fixture itself fails is a wrong rule, not a bad system.
  it("accepts a whole system, renamed and bundled", () => {
    expect(() => refuseUninstallableBundle(bundleFor("toybox"))).not.toThrow();
  });

  /**
   * Nothing is compiled into this build, so the guard has no case to catch. The
   * built-in list is stood up for the length of the test rather than left to
   * rot — see the same arrangement in `systems.test.ts`.
   */
  it("refuses to overwrite a system this application ships", () => {
    const bundle = readSystemBundle(buildSystemBundle(systemContentFor("toybox")));
    builtinSystems.toybox = bundle.system;
    try {
      expect(() => refuseUninstallableBundle(bundle)).toThrow(/is a system this application ships/);
    } finally {
      delete builtinSystems.toybox;
    }
  });

  it("refuses two sheet lists under one key", () => {
    const bundle = bent((system) => {
      const sheet = (system as Record<string, { lists: unknown[] }>).characterSheet;
      sheet.lists = [...sheet.lists, sheet.lists[0]];
    });
    expect(() => refuseUninstallableBundle(bundle)).toThrow(/declares two lists called "inventory"/);
  });

  it("refuses a hit points key that names no statblock field", () => {
    const bundle = bent((system) => {
      (system as Record<string, { hitPointsKey: string }>).npcStatblock.hitPointsKey = "wounds";
    });
    expect(() => refuseUninstallableBundle(bundle)).toThrow(/hitPointsKey is "wounds", which is not one of/);
  });

  it("refuses an armour key that names no statblock field", () => {
    const bundle = bent((system) => {
      (system as Record<string, { armorKey: string }>).npcStatblock.armorKey = "plating";
    });
    expect(() => refuseUninstallableBundle(bundle)).toThrow(/armorKey is "plating"/);
  });

  it("refuses a warning rule that reads a field the sheet has not got", () => {
    // A rule naming a field nothing writes can never fire. Silent, and so worse
    // than being told at the door.
    const bundle = bent((system) => {
      (system as Record<string, unknown[]>).warningRules = [
        { kind: "range", key: "sanity", max: 10, message: "Sanity is failing." }
      ];
    });
    expect(() => refuseUninstallableBundle(bundle)).toThrow(/reads "sanity", which is not a field or list/);
  });

  it("refuses a comparison against a field the sheet has not got", () => {
    const bundle = bent((system) => {
      (system as Record<string, unknown[]>).warningRules = [
        { kind: "compare", key: "hpCurrent", against: "luck", operator: ">", message: "over" }
      ];
    });
    expect(() => refuseUninstallableBundle(bundle)).toThrow(/reads "luck"/);
  });

  it("accepts a warning rule that reads one of the sheet's lists", () => {
    const bundle = bent((system) => {
      (system as Record<string, unknown[]>).warningRules = [
        { kind: "list-occupancy", listKey: "inventory", tiers: [{ atLeast: 6, message: "Full." }] }
      ];
    });
    expect(() => refuseUninstallableBundle(bundle)).not.toThrow();
  });

  it("refuses a content module pointing at a source document the bundle has not got", () => {
    const bundle = bent((system) => {
      (system as Record<string, { sourceDocumentId: string }[]>).contentModules[0].sourceDocumentId = "elsewhere";
    });
    expect(() => refuseUninstallableBundle(bundle)).toThrow(/names source document "elsewhere"/);
  });
});

describe("writing an installed system", () => {
  const system = "toybox-2";
  const root = installedSystemRoot(system);
  const staging = `${root}.incoming`;

  const bundle = () => readSystemBundle(buildSystemBundle(renameSystem(systemContentFor("toybox"), system)));

  it("restores the previous content when replacing it cannot rename the staging directory", () => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(`${root}.replaced`, { recursive: true, force: true });
    writeSystemBundle(bundle());

    const rename = fs.renameSync;
    const blocked = vi.spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      if (String(from) === staging && String(to) === root) throw new Error("rename blocked");
      return rename.call(fs, from, to);
    }) as typeof fs.renameSync);
    try {
      expect(() => writeSystemBundle(bundle())).toThrow("rename blocked");
    } finally {
      blocked.mockRestore();
    }

    expect(fs.existsSync(root)).toBe(true);
    expect(fs.existsSync(`${root}.replaced`)).toBe(false);
  });

  it("recovers a replaced directory left behind by an interrupted replacement on startup", () => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(`${root}.replaced`, { recursive: true, force: true });
    writeSystemBundle(bundle());
    fs.renameSync(root, `${root}.replaced`);

    expect(installedSystemIds()).toContain(system);
    expect(fs.existsSync(root)).toBe(true);
    expect(fs.existsSync(`${root}.replaced`)).toBe(false);
  });
});
