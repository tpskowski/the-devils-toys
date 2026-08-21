import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db.js";
import { systemReleaseFingerprint } from "./system-breaking.js";
import { forgetSystemMarkers } from "./system-sources.js";
import { catalogueOffers, isCommitRef, systemUpdates, updateStateFor } from "./system-updates.js";

/**
 * The seven answers, and the rule that every one of them belongs to its own row.
 *
 * Nothing here reaches the network: `fetch` is stubbed per test and told what
 * each repository is serving, which is also how "one repository is down" is put
 * in front of the check without waiting for one to actually be.
 */

const calls: string[] = [];
let serve: (url: string) => Response | Promise<Response> = () => new Response("Not Found", { status: 404 });

/** A marker as a repository serves it, with a version only where one is given. */
function marker(systemId: string, version?: string, release: { breaking?: boolean; releaseNotes?: string[] } = {}) {
  const declaresReleaseMetadata = release.breaking !== undefined || release.releaseNotes !== undefined;
  return new Response(
    JSON.stringify({
      app: "devils-toys-system",
      formatVersion: declaresReleaseMetadata ? 2 : 1,
      systemId,
      systemName: systemId,
      licenses: ["CC0 1.0"],
      ...(version === undefined ? {} : { version }),
      ...release
    })
  );
}

/** Records a system the way an install does, without installing any content. */
function record(id: string, manifest: Record<string, unknown>) {
  db.prepare("INSERT INTO systems (id, name, origin, retired, manifest_json) VALUES (?, ?, 'installed', 0, ?)").run(
    id,
    id,
    JSON.stringify(manifest)
  );
}

/** A system imported from a repository, as `manifest_json` holds one. */
const fromRepository = (version: string, repository: string, ref = "main") => ({
  version,
  source: { repository, ref, revision: "deadbee", fetchedAt: "2026-01-01T00:00:00.000Z" }
});

beforeEach(() => {
  db.exec("DELETE FROM systems;");
  calls.length = 0;
  forgetSystemMarkers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string) => {
      calls.push(String(input));
      return serve(String(input));
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  forgetSystemMarkers();
});

const answerFor = async (id: string) => (await systemUpdates()).find((update) => update.id === id)!;

describe("what a check says about one system", () => {
  it("says newer only where the repository's version is provably later", async () => {
    record("toybox", fromRepository("1.0.0", "owner/toybox"));
    serve = () => marker("toybox", "1.1.0");

    expect(await answerFor("toybox")).toMatchObject({
      state: "newer",
      installedVersion: "1.0.0",
      availableVersion: "1.1.0",
      repository: "owner/toybox",
      ref: "main",
      reason: ""
    });
  });

  it("returns breaking release metadata and normalizes a marker that omits it", async () => {
    record("breaking", fromRepository("1.0.0", "owner/breaking"));
    record("ordinary", fromRepository("1.0.0", "owner/ordinary"));
    serve = (url) =>
      url.includes("/owner/breaking/")
        ? marker("breaking", "1.1.0", {
            breaking: true,
            releaseNotes: ["Rebuild existing character sheets.", "Review optional rules."]
          })
        : marker("ordinary", "1.1.0");

    const answers = await systemUpdates();
    expect(answers.find((answer) => answer.id === "breaking")).toMatchObject({
      breaking: true,
      releaseNotes: ["Rebuild existing character sheets.", "Review optional rules."],
      releaseFingerprint: systemReleaseFingerprint("breaking", {
        version: "1.1.0",
        breaking: true,
        releaseNotes: ["Rebuild existing character sheets.", "Review optional rules."]
      })
    });
    expect(answers.find((answer) => answer.id === "ordinary")).toMatchObject({
      breaking: false,
      releaseNotes: [],
      releaseFingerprint: systemReleaseFingerprint("ordinary", { version: "1.1.0", breaking: false, releaseNotes: [] })
    });
  });

  it("says differs where the two versions are not comparable", async () => {
    record("toybox", fromRepository("1.0.0", "owner/toybox"));
    serve = () => marker("toybox", "2026-05-01");

    expect(await answerFor("toybox")).toMatchObject({ state: "differs", availableVersion: "2026-05-01" });
  });

  it("says differs rather than newer where the repository has gone backwards", async () => {
    record("toybox", fromRepository("2.0.0", "owner/toybox"));
    serve = () => marker("toybox", "1.9.0");

    expect(await answerFor("toybox")).toMatchObject({ state: "differs" });
  });

  it("says current where the repository is offering what is installed", async () => {
    record("toybox", fromRepository("1.0.0", "owner/toybox"));
    serve = () => marker("toybox", "1.0");

    expect(await answerFor("toybox")).toMatchObject({ state: "current", availableVersion: "1.0" });
  });

  /** A commit is immutable, so a check against one could only ever say `current`. */
  it("says pinned, and asks nothing, where the stored ref is a commit", async () => {
    record("toybox", fromRepository("1.0.0", "owner/toybox", "4f1c2ab9d3e5a7061b2c3d4e5f60718293a4b5c6"));

    expect(await answerFor("toybox")).toMatchObject({ state: "pinned", availableVersion: "" });
    expect(calls).toEqual([]);
  });

  it("says unsourced, and asks nothing, for a system installed from a file", async () => {
    record("toybox", { version: "1.0.0" });

    expect(await answerFor("toybox")).toMatchObject({
      state: "unsourced",
      repository: "",
      ref: "",
      releaseFingerprint: ""
    });
    expect(calls).toEqual([]);
  });

  it("says unknown where either side declares no version", async () => {
    record("unversioned", fromRepository("", "owner/unversioned"));
    record("upstream-quiet", fromRepository("1.0.0", "owner/quiet"));
    serve = (url) => (url.includes("/owner/quiet/") ? marker("upstream-quiet") : marker("unversioned", "1.0.0"));

    expect(await answerFor("unversioned")).toMatchObject({ state: "unknown", availableVersion: "1.0.0" });
    expect(await answerFor("upstream-quiet")).toMatchObject({ state: "unknown", availableVersion: "" });
  });

  it("says unreachable, and carries the reason, where the repository would not answer", async () => {
    record("toybox", fromRepository("1.0.0", "owner/toybox"));
    serve = () => new Response("Not Found", { status: 404 });

    const answer = await answerFor("toybox");
    expect(answer.state).toBe("unreachable");
    expect(answer.reason).toMatch(/answered 404/);
    expect(answer.installedVersion).toBe("1.0.0");
    expect(answer.releaseFingerprint).toBe("");
  });

  /** A ref with a slash in it is a branch, and is asked about rather than assumed. */
  it("asks about a branch whose name is not a commit's shape", async () => {
    record("toybox", fromRepository("1.0.0", "owner/toybox", "release/2026"));
    serve = () => marker("toybox", "1.0.0");

    expect(await answerFor("toybox")).toMatchObject({ state: "current", ref: "release/2026" });
    expect(calls).toEqual(["https://raw.githubusercontent.com/owner/toybox/release/2026/devilsystem.json"]);
  });
});

describe("recognising a commit", () => {
  it("reads a hex ref of a commit's length as a commit", () => {
    expect(isCommitRef("4f1c2ab")).toBe(true);
    expect(isCommitRef("4f1c2ab9d3e5a7061b2c3d4e5f60718293a4b5c6")).toBe(true);
    expect(isCommitRef("4F1C2AB9D3E5A7061B2C3D4E5F60718293A4B5C6")).toBe(true);
  });

  it("reads a branch or a tag as neither", () => {
    for (const ref of ["main", "next", "v1.2.0", "refs/tags/v1.0", "release/2026", "abc123", ""])
      expect(isCommitRef(ref)).toBe(false);
  });
});

describe("one repository being down", () => {
  /**
   * Decision 7. A failed fetch is that row's answer and never the route's: the
   * two systems that did answer must still be answered, or an admin loses six
   * true rows to one server having a bad day.
   */
  it("is that system's answer and leaves every other row intact", async () => {
    record("alpha", fromRepository("1.0.0", "owner/alpha"));
    record("beta", fromRepository("1.0.0", "owner/beta"));
    record("gamma", fromRepository("1.0.0", "owner/gamma"));
    serve = (url) => (url.includes("/owner/beta/") ? new Response("nope", { status: 500 }) : marker("x", "1.1.0"));

    const answers = await systemUpdates();
    expect(answers.map((answer) => [answer.id, answer.state])).toEqual([
      ["alpha", "newer"],
      ["beta", "unreachable"],
      ["gamma", "newer"]
    ]);
    expect(answers.find((answer) => answer.id === "beta")!.reason).toMatch(/answered 500/);
  });

  /**
   * There may be several systems and they have nothing to do with each other, so
   * an admin should wait for the slowest repository rather than for all of them
   * added together. Held open until all three have been asked: in series the
   * first would still be waiting and the other two would never be sent.
   */
  it("asks every repository at once rather than one after another", async () => {
    for (const id of ["alpha", "beta", "gamma"]) record(id, fromRepository("1.0.0", `owner/${id}`));
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    serve = async () => {
      await held;
      return marker("x", "1.0.0");
    };

    const pending = systemUpdates();
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    release();
    expect((await pending).map((answer) => answer.state)).toEqual(["current", "current", "current"]);
  });
});

describe("what the catalogue menu offers", () => {
  const entry = (id: string, version: string) => ({
    id,
    name: id,
    tagline: "",
    repository: `owner/${id}`,
    ref: "main",
    license: "",
    author: "",
    version,
    homepage: ""
  });

  it("offers an update only where the version on offer is provably later", async () => {
    record("toybox", fromRepository("1.0.0", "owner/toybox"));
    serve = () => marker("toybox", "1.1.0");

    const [offer] = await catalogueOffers([entry("toybox", "1.1.0")]);
    expect(offer).toMatchObject({ installed: true, installedVersion: "1.0.0", updateState: "newer" });
    expect(offer.updateAvailable).toBe(true);
  });

  it("propagates breaking release metadata from the marker into an installed catalogue offer", async () => {
    record("toybox", fromRepository("1.0.0", "owner/toybox"));
    serve = () => marker("toybox", "1.1.0", { breaking: true, releaseNotes: ["Migrate active rooms."] });

    const [offer] = await catalogueOffers([entry("toybox", "1.1.0")]);
    expect(offer).toMatchObject({
      breaking: true,
      releaseNotes: ["Migrate active rooms."],
      releaseFingerprint: systemReleaseFingerprint("toybox", {
        version: "1.1.0",
        breaking: true,
        releaseNotes: ["Migrate active rooms."]
      })
    });
  });

  /**
   * The bug this replaced: `entry.version !== installed` offered an update for
   * any inequality at all, so a catalogue entry carrying the *book's* version
   * rather than the packaging's produced an offer that pressing could never
   * clear — the install wrote the marker's version back and the two strings went
   * on being unequal.
   */
  it("offers nothing where the catalogue's version is not comparable to the installed one", async () => {
    record("monolith", fromRepository("0.1.0", "owner/monolith"));
    serve = () => marker("monolith", "0.1.0-rc1");

    const [offer] = await catalogueOffers([entry("monolith", "1.1")]);
    expect(offer.updateAvailable).toBe(false);
    expect(offer.updateState).toBe("differs");
  });

  it("offers nothing where the versions are the same", async () => {
    record("toybox", fromRepository("1.0.0", "owner/toybox"));
    serve = () => marker("toybox", "1.0.0");

    const [offer] = await catalogueOffers([entry("toybox", "1.0.0")]);
    expect(offer.updateAvailable).toBe(false);
    expect(offer.updateState).toBe("current");
  });

  /**
   * Decision 5, and the plan's third open question: both versions are the
   * author's, and the catalogue entry is the one written in a second place.
   */
  it("lets the marker win over a catalogue entry that has gone stale", async () => {
    record("monolith", fromRepository("0.1.0", "owner/monolith"));
    serve = () => marker("monolith", "0.1.0");

    const [offer] = await catalogueOffers([entry("monolith", "1.1")]);
    expect(offer.version).toBe("0.1.0");
    expect(offer.updateState).toBe("current");
    expect(offer.updateAvailable).toBe(false);
  });

  it("does not invent an update from the catalogue when the marker is unversioned", async () => {
    record("toybox", fromRepository("1.0.0", "owner/toybox"));
    serve = () => marker("toybox");

    const [offer] = await catalogueOffers([entry("toybox", "2.0.0")]);
    expect(offer.version).toBe("");
    expect(offer.updateState).toBe("unknown");
    expect(offer.updateAvailable).toBe(false);
  });

  it("falls back to the catalogue's version where the repository would not answer", async () => {
    record("toybox", fromRepository("1.0.0", "owner/toybox"));
    serve = () => new Response("Not Found", { status: 404 });

    const [offer] = await catalogueOffers([entry("toybox", "1.2.0")]);
    expect(offer.version).toBe("1.2.0");
    expect(offer.updateAvailable).toBe(true);
  });

  it("offers nothing to update for an entry nobody has installed", async () => {
    const [offer] = await catalogueOffers([entry("cairn", "1.0.0")]);
    expect(offer).toMatchObject({
      installed: false,
      installedVersion: "",
      breaking: false,
      releaseNotes: [],
      releaseFingerprint: "",
      updateAvailable: false
    });
    expect(calls).toEqual([]);
  });
});

describe("turning a pair of versions into an answer", () => {
  it("uses one vocabulary for both surfaces", () => {
    expect(updateStateFor("1.0.0", "1.1.0")).toBe("newer");
    expect(updateStateFor("1.0.0", "1.0.0")).toBe("current");
    expect(updateStateFor("1.0.0", "v1.0.0")).toBe("differs");
    expect(updateStateFor("", "1.0.0")).toBe("unknown");
    expect(updateStateFor("1.0.0", "")).toBe("unknown");
  });
});

describe("the marker cache", () => {
  it("asks a repository once for as long as the answer is held", async () => {
    record("toybox", fromRepository("1.0.0", "owner/toybox"));
    serve = () => marker("toybox", "1.1.0");

    await systemUpdates();
    await systemUpdates();
    expect(calls).toHaveLength(1);

    forgetSystemMarkers();
    await systemUpdates();
    expect(calls).toHaveLength(2);
  });

  it("asks once for two systems sharing a repository and ref", async () => {
    record("alpha", fromRepository("1.0.0", "owner/shared"));
    record("beta", fromRepository("1.0.0", "owner/shared"));
    serve = () => marker("shared", "1.0.0");

    // Sequentially, so the second read is a hit rather than a second flight.
    await systemUpdates();
    calls.length = 0;
    const answers = await systemUpdates();
    expect(answers.map((answer) => answer.state)).toEqual(["current", "current"]);
    expect(calls).toEqual([]);
  });
});
