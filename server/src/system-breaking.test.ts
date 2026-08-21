import { describe, expect, it } from "vitest";
import { breakingSystemChange, systemReleaseFingerprint } from "./system-breaking.js";

const release = (version: string, breaking = false, releaseNotes: string[] = []) => ({
  version,
  breaking,
  releaseNotes
});

describe("a declared breaking system release", () => {
  it("does not interrupt a first install", () => {
    expect(breakingSystemChange("toybox", "Toybox", undefined, release("2.0.0", true, ["Changed."]))).toBeUndefined();
  });

  it("requires review before it replaces another release", () => {
    expect(
      breakingSystemChange("toybox", "Toybox", release("1.0.0"), release("2.0.0", true, ["Renamed Luck."]))
    ).toMatchObject({
      systemId: "toybox",
      systemName: "Toybox",
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      notes: ["Renamed Luck."]
    });
  });

  it("does not ask twice for the exact release already installed", () => {
    const installed = release("2.0.0", true, ["Renamed Luck."]);
    expect(breakingSystemChange("toybox", "Toybox", installed, installed)).toBeUndefined();
  });

  it("binds the acknowledgement to the id, version, flag, and notes", () => {
    const base = release("2.0.0", true, ["Renamed Luck."]);
    const fingerprint = systemReleaseFingerprint("toybox", base);
    expect(systemReleaseFingerprint("toybox", base)).toBe(fingerprint);
    expect(systemReleaseFingerprint("plainbox", base)).not.toBe(fingerprint);
    expect(systemReleaseFingerprint("toybox", release("2.0.1", true, base.releaseNotes))).not.toBe(fingerprint);
    expect(systemReleaseFingerprint("toybox", release("2.0.0", true, ["Removed Luck."]))).not.toBe(fingerprint);
  });
});
