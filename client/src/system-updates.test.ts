import { describe, expect, it } from "vitest";
import { systemUpdateNotice, type SystemUpdate, type SystemUpdateState } from "./system-updates";

function answer(state: SystemUpdateState, fields: Partial<SystemUpdate> = {}): SystemUpdate {
  return {
    id: "monolith",
    name: "Monolith",
    state,
    installedVersion: "1.1",
    availableVersion: "1.2.0",
    repository: "tpskowski/devils-toys-monolith",
    ref: "main",
    reason: "",
    breaking: false,
    releaseNotes: [],
    releaseFingerprint: "",
    ...fields
  };
}

describe("system update notices", () => {
  it("offers the version by name where one is provably newer", () => {
    const notice = systemUpdateNotice(answer("newer"));
    expect(notice.action).toBe("Update to 1.2.0");
    // The button says it; a sentence beside it would say it twice.
    expect(notice.message).toBe("");
    expect(notice.warning).toBe(false);
  });

  it("names a breaking action as a review before installation", () => {
    expect(systemUpdateNotice(answer("newer", { breaking: true })).action).toBe("Review update to 1.2.0");
    expect(systemUpdateNotice(answer("differs", { breaking: true })).action).toBe("Review reinstall");
  });

  it("calls a version it cannot compare a reinstall rather than an update", () => {
    const notice = systemUpdateNotice(answer("differs", { availableVersion: "0.1.0" }));
    expect(notice.action).toBe("Reinstall");
    expect(notice.message).toContain("offering 0.1.0");
    expect(notice.message).toContain("nor provably later");
  });

  it("says nothing at all about a system that is up to date", () => {
    expect(systemUpdateNotice(answer("current"))).toEqual({ origin: "", message: "", warning: false, action: "" });
  });

  it("puts a pinned or unsourced system in the line that says where it came from", () => {
    expect(systemUpdateNotice(answer("pinned", { ref: "9f8e7d6" }))).toMatchObject({
      origin: "pinned to a commit",
      message: "",
      action: ""
    });
    expect(systemUpdateNotice(answer("unsourced", { repository: "", ref: "" }))).toMatchObject({
      origin: "nothing to update from",
      message: "",
      action: ""
    });
  });

  it("names whichever side of an unknown comparison is missing", () => {
    expect(systemUpdateNotice(answer("unknown", { installedVersion: "" })).message).toContain(
      "This system declares no version"
    );
    expect(systemUpdateNotice(answer("unknown", { availableVersion: "" })).message).toContain(
      "declares no version, so there is nothing to measure 1.1 against"
    );
    expect(systemUpdateNotice(answer("unknown", { installedVersion: "", availableVersion: "" })).message).toContain(
      "Neither this system nor"
    );
  });

  it("shows why an unreachable repository could not be read, and offers no button", () => {
    const notice = systemUpdateNotice(answer("unreachable", { reason: "That host is not allowed." }));
    expect(notice.warning).toBe(true);
    expect(notice.message).toContain("That host is not allowed.");
    expect(notice.action).toBe("");
  });

  it("leaves a row unmarked where the check itself could not be run", () => {
    expect(systemUpdateNotice(undefined)).toEqual({ origin: "", message: "", warning: false, action: "" });
  });
});
