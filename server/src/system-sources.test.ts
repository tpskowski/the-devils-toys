import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { gzipSync, strToU8 } from "fflate";
import {
  catalogSchema,
  fetchSystemMarker,
  forgetSystemMarkers,
  isAllowedSource,
  markerUrl,
  readSystemRepoArchive,
  sourceArchiveUrl
} from "./system-sources.js";
import { readTar, stripArchivePrefix } from "./system-tar.js";
import { SYSTEM_REPO_MARKER, buildSystemRepoMarker } from "./system-repo.js";
import { renameSystem } from "./system-bundles.js";
import { builtinSystems } from "./builtin-systems.js";
import { installedSystemRoot } from "./system-content.js";
import {
  refuseUninstallableBundle,
  systemContentFor,
  verifySystemTables,
  writeSystemBundle
} from "./system-install.js";
import { installToybox } from "./test-fixture.js";

installToybox();

/** The fixture under another id, so installing it cannot collide with itself. */
const renamed = () => renameSystem(systemContentFor("toybox"), "toybox-imported");

const BLOCK = 512;

/** A tar of exactly the shape GitHub serves: every path under one directory. */
function tar(files: Record<string, Uint8Array | string>) {
  const blocks: Uint8Array[] = [];
  for (const [name, body] of Object.entries(files)) {
    const bytes = typeof body === "string" ? strToU8(body) : body;
    const header = new Uint8Array(BLOCK);
    const write = (text: string, at: number) => header.set(strToU8(text), at);
    write(name, 0);
    write("000644 ", 100);
    write(`${bytes.byteLength.toString(8).padStart(11, "0")} `, 124);
    write("00000000000 ", 136);
    write("0", 156);
    write("ustar\0", 257);
    write("00", 263);
    // The checksum is written with its own field read as spaces, which is the
    // convention every tar follows and no reader here depends on.
    header.set(strToU8("        "), 148);
    const sum = header.reduce((total, byte) => total + byte, 0);
    write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);

    blocks.push(header);
    const padded = new Uint8Array(Math.ceil(bytes.byteLength / BLOCK) * BLOCK);
    padded.set(bytes);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(BLOCK * 2));

  const total = blocks.reduce((size, block) => size + block.byteLength, 0);
  const archive = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    archive.set(block, offset);
    offset += block.byteLength;
  }
  return archive;
}

/** The fixture, laid out as a repository archive under a generated directory. */
function repositoryArchive(
  overrides: Record<string, string | null> = {},
  prefix = "devils-toys-toybox-4f1c2ab",
  content = systemContentFor("toybox")
) {
  const files: Record<string, string> = {
    [`${prefix}/${SYSTEM_REPO_MARKER}`]: JSON.stringify(buildSystemRepoMarker(content.system)),
    [`${prefix}/system.json`]: JSON.stringify(content.system),
    [`${prefix}/items.json`]: JSON.stringify(content.items),
    [`${prefix}/traits.json`]: JSON.stringify(content.traits),
    // Everything a repository carries that a system has no use for.
    [`${prefix}/README.md`]: "# Toybox\n",
    [`${prefix}/AGENTS.md`]: "Working notes.\n",
    [`${prefix}/LICENSE`]: "CC0 1.0\n",
    [`${prefix}/notes.md`]: "Notes.\n",
    [`${prefix}/.github/workflows/validate.yml`]: "on: push\n",
    [`${prefix}/source/Toybox.pdf`]: "not really a pdf"
  };
  for (const [name, markdown] of Object.entries(content.rules)) files[`${prefix}/rules/${name}`] = markdown;
  for (const [name, json] of Object.entries(content.tables)) files[`${prefix}/tables/${name}`] = json;

  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) delete files[`${prefix}/${name}`];
    else files[`${prefix}/${name}`] = value;
  }
  return gzipSync(tar(files));
}

const source = { repository: "tpskowski/devils-toys-toybox", ref: "main" };

describe("reading a system out of a repository archive", () => {
  it("reads the same system a checkout would", () => {
    const content = systemContentFor("toybox");
    const read = readSystemRepoArchive(repositoryArchive(), source);

    expect(read.system).toEqual(JSON.parse(JSON.stringify(content.system)));
    expect(read.items).toEqual(content.items);
    expect(read.traits).toEqual(content.traits);
    expect(read.rules).toEqual(content.rules);
    expect(read.tables).toEqual(content.tables);
  });

  it("records where it came from, including the commit the archive names", () => {
    const read = readSystemRepoArchive(repositoryArchive(), source);
    expect(read.source).toMatchObject({
      repository: "tpskowski/devils-toys-toybox",
      ref: "main",
      revision: "devils-toys-toybox-4f1c2ab"
    });
    expect(Date.parse(read.source.fetchedAt)).not.toBeNaN();
  });

  /** The whole difference between a repository and a bundle. */
  it("ignores a repository's own files rather than refusing them", () => {
    expect(() => readSystemRepoArchive(repositoryArchive(), source)).not.toThrow();
  });

  it("refuses an archive that is not a system at all", () => {
    expect(() => readSystemRepoArchive(repositoryArchive({ [SYSTEM_REPO_MARKER]: null }), source)).toThrow(
      /no devilsystem\.json/
    );
  });

  it("refuses an archive whose system.json does not parse", () => {
    expect(() => readSystemRepoArchive(repositoryArchive({ "system.json": "{" }), source)).toThrow(
      /could not be read as JSON/
    );
  });

  it("refuses something that is not a gzip at all", () => {
    expect(() => readSystemRepoArchive(strToU8("not an archive"), source)).toThrow(/not a readable gzip archive/);
  });

  /**
   * The prefix is stripped, so a path that climbs out of it would arrive looking
   * like an ordinary relative path. It has to be refused after stripping, which
   * is where `readSystemRepoFiles` checks it — this proves the two agree.
   */
  it("refuses an entry that would write outside the system", () => {
    const prefix = "devils-toys-toybox-4f1c2ab";
    const archive = repositoryArchive({ "rules/../../escape.md": "no" }, prefix);
    expect(() => readSystemRepoArchive(archive, source)).toThrow(/would write outside it/);
  });
});

describe("installing what an archive carried", () => {
  /**
   * The point of the whole exercise: a system downloaded as a repository goes
   * through exactly the checks an uploaded bundle does, and lands on disk the
   * same way. Nothing here is network — the archive is built above — so this is
   * the install path, proven without a flaky dependency on GitHub being up.
   */
  it("passes every check an uploaded bundle passes, and writes the same content", () => {
    const fetched = readSystemRepoArchive(repositoryArchive({}, "devils-toys-toybox-4f1c2ab", renamed()), source);

    expect(() => refuseUninstallableBundle(fetched)).not.toThrow();
    expect(() => verifySystemTables(fetched.system.id, fetched.system, fetched.tables)).not.toThrow();

    const result = writeSystemBundle(fetched);
    expect(result).toMatchObject({ system: "toybox-imported", replaced: false });
    expect(result.licenses).toEqual(["CC0 1.0"]);

    const root = installedSystemRoot("toybox-imported");
    expect(readdirSync(root).sort()).toEqual(["items.json", "rules", "system.json", "tables", "traits.json"]);
    expect(JSON.parse(readFileSync(join(root, "system.json"), "utf8")).id).toBe("toybox-imported");
    rmSync(root, { recursive: true, force: true });
  });

  it("is refused when the archive's system would shadow one that ships", () => {
    const fetched = readSystemRepoArchive(repositoryArchive(), source);
    builtinSystems.toybox = fetched.system;
    try {
      expect(() => refuseUninstallableBundle(fetched)).toThrow(/is a system this application ships/);
    } finally {
      delete builtinSystems.toybox;
    }
  });
});

describe("reading a tar", () => {
  it("strips the one directory every entry sits under", () => {
    const entries = readTar(
      tar({ "repo-abc123/system.json": "{}", "repo-abc123/rules/Book.md": "# Book" }),
      1024 * 1024
    );
    const stripped = stripArchivePrefix(entries);
    expect(stripped.prefix).toBe("repo-abc123");
    expect(stripped.entries.map((entry) => entry.name)).toEqual(["system.json", "rules/Book.md"]);
  });

  it("leaves an archive alone when its entries share no single root", () => {
    const stripped = stripArchivePrefix(readTar(tar({ "a/one.md": "1", "b/two.md": "2" }), 1024 * 1024));
    expect(stripped.prefix).toBe("");
    expect(stripped.entries.map((entry) => entry.name)).toEqual(["a/one.md", "b/two.md"]);
  });

  it("abandons an archive that expands past the cap", () => {
    expect(() => readTar(tar({ "repo/big.md": "x".repeat(4096) }), 1024)).toThrow(/expands beyond/);
  });
});

describe("where a system may be fetched from", () => {
  it("allows the hosts a system actually comes from", () => {
    expect(isAllowedSource(new URL("https://codeload.github.com/a/b/tar.gz/main"))).toBe(true);
    expect(isAllowedSource(new URL("https://raw.githubusercontent.com/a/b/main/index.json"))).toBe(true);
  });

  it("refuses anything else, including plain HTTP and the local network", () => {
    expect(isAllowedSource(new URL("http://codeload.github.com/a/b/tar.gz/main"))).toBe(false);
    expect(isAllowedSource(new URL("https://example.com/system.tar.gz"))).toBe(false);
    expect(isAllowedSource(new URL("https://127.0.0.1/system.tar.gz"))).toBe(false);
    expect(isAllowedSource(new URL("https://169.254.169.254/latest/meta-data/"))).toBe(false);
    // A host that merely ends with an allowed one is a different host.
    expect(isAllowedSource(new URL("https://codeload.github.com.evil.test/a/b"))).toBe(false);
  });

  it("builds an archive URL only from a name and ref it can vouch for", () => {
    expect(sourceArchiveUrl("tpskowski/devils-toys-cairn", "main")).toBe(
      "https://codeload.github.com/tpskowski/devils-toys-cairn/tar.gz/main"
    );
    expect(sourceArchiveUrl("owner/repo", "refs/tags/v1.2.0")).toContain("/tar.gz/refs/tags/v1.2.0");
  });

  it("refuses a repository or ref that could build a path of its own", () => {
    for (const repository of ["not-a-repo", "owner/repo/extra", "../../etc", "owner/repo?x=1"])
      expect(() => sourceArchiveUrl(repository, "main")).toThrow(/not an owner\/repository name/);
    for (const ref of ["../../../etc/passwd", "main?x=1", "a b", "#fragment"])
      expect(() => sourceArchiveUrl("owner/repo", ref)).toThrow(/not a usable branch, tag, or commit/);
  });

  it("builds a marker URL on the host the catalogue already comes from", () => {
    expect(markerUrl("tpskowski/devils-toys-cairn", "main")).toBe(
      "https://raw.githubusercontent.com/tpskowski/devils-toys-cairn/main/devilsystem.json"
    );
    expect(markerUrl("owner/repo", "refs/tags/v1.2.0")).toBe(
      "https://raw.githubusercontent.com/owner/repo/refs/tags/v1.2.0/devilsystem.json"
    );
    expect(isAllowedSource(new URL(markerUrl("owner/repo", "main")))).toBe(true);
  });

  /**
   * The same refusals `sourceArchiveUrl` makes, for the same reason: a ref that
   * can spell `..` is a ref that can name a file somewhere else on the host, and
   * this one builds a path out of a ref rather than handing it to an endpoint.
   */
  it("refuses a repository or ref a marker URL could be built out of", () => {
    for (const repository of ["not-a-repo", "owner/repo/extra", "../../etc", "owner/repo?x=1", "owner/repo#frag"])
      expect(() => markerUrl(repository, "main")).toThrow(/not an owner\/repository name/);
    for (const ref of ["../../../etc/passwd", "main/../../..", "main?x=1", "a b", "#fragment", ".."])
      expect(() => markerUrl("owner/repo", ref)).toThrow(/not a usable branch, tag, or commit/);
  });
});

describe("reading one repository's marker", () => {
  const marker = (extra: Record<string, unknown> = {}) => ({
    app: "devils-toys-system",
    formatVersion: 1,
    systemId: "toybox",
    systemName: "Toybox",
    licenses: ["CC0 1.0"],
    ...extra
  });

  /**
   * Stubs the one outbound call, and reports what it was asked for. Each answer
   * is built fresh on the call it serves, because a `Response` body may only be
   * read once; the last one stands for every call after it.
   */
  function serve(...answers: Array<() => Response>) {
    const calls: string[] = [];
    const remaining = [...answers];
    const stub = vi.fn(async (input: URL | string) => {
      calls.push(String(input));
      return (remaining.length > 1 ? remaining.shift()! : remaining[0])();
    });
    vi.stubGlobal("fetch", stub);
    return calls;
  }

  const json =
    (body: unknown, status = 200) =>
    () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

  afterEach(() => {
    vi.unstubAllGlobals();
    forgetSystemMarkers();
  });

  it("asks the marker URL and reads the version out of it", async () => {
    const calls = serve(json(marker({ version: "1.2.0" })));
    await expect(fetchSystemMarker("owner/repo", "main")).resolves.toMatchObject({
      systemId: "toybox",
      version: "1.2.0"
    });
    expect(calls).toEqual(["https://raw.githubusercontent.com/owner/repo/main/devilsystem.json"]);
  });

  /** Optional is the whole of decision 2: no version is unversioned, not invalid. */
  it("reads a marker that declares no version at all", async () => {
    serve(json(marker()));
    const read = await fetchSystemMarker("owner/repo", "main");
    expect(read.systemId).toBe("toybox");
    expect(read.version).toBeUndefined();
  });

  it("refuses a body that is not a marker", async () => {
    serve(json("<!doctype html>"));
    await expect(fetchSystemMarker("owner/repo", "main")).rejects.toThrow(/readable devilsystem\.json/);

    forgetSystemMarkers();
    serve(json({ app: "devils-toys-system", formatVersion: 1 }));
    await expect(fetchSystemMarker("owner/repo", "main")).rejects.toThrow(/not a valid system marker/);
  });

  it("says so when the repository has no marker to serve", async () => {
    serve(json("Not Found", 404));
    await expect(fetchSystemMarker("owner/repo", "main")).rejects.toThrow(/answered 404/);
  });

  it("refuses to build the request at all from a ref that could climb", async () => {
    const calls = serve(json(marker()));
    await expect(fetchSystemMarker("owner/repo", "../../secrets")).rejects.toThrow(/not a usable branch/);
    expect(calls).toEqual([]);
  });

  it("reuses what it read until it is told to forget it", async () => {
    const calls = serve(json(marker({ version: "1.0.0" })), json(marker({ version: "9.9.9" })));

    expect((await fetchSystemMarker("owner/repo", "main")).version).toBe("1.0.0");
    expect((await fetchSystemMarker("owner/repo", "main")).version).toBe("1.0.0");
    expect(calls).toHaveLength(1);

    // A different ref of the same repository is a different question.
    expect((await fetchSystemMarker("owner/repo", "next")).version).toBe("9.9.9");
    expect(calls).toHaveLength(2);

    forgetSystemMarkers();
    expect((await fetchSystemMarker("owner/repo", "main")).version).toBe("9.9.9");
    expect(calls).toHaveLength(3);
  });

  /** A failure is not cached, so a repository that was briefly down is asked again. */
  it("asks again after a failure rather than reporting it for the whole TTL", async () => {
    const calls = serve(json("Not Found", 404), json(marker({ version: "1.0.0" })));
    await expect(fetchSystemMarker("owner/repo", "main")).rejects.toThrow(/answered 404/);
    await expect(fetchSystemMarker("owner/repo", "main")).resolves.toMatchObject({ version: "1.0.0" });
    expect(calls).toHaveLength(2);
  });
});

describe("the catalogue index", () => {
  it("reads an entry, filling in what an author left out", () => {
    const parsed = catalogSchema.parse({
      formatVersion: 1,
      systems: [{ id: "cairn", name: "Cairn", repository: "tpskowski/devils-toys-cairn" }]
    });
    expect(parsed.systems[0]).toMatchObject({ ref: "main", tagline: "", version: "" });
  });

  it("refuses an entry whose repository is not a repository", () => {
    expect(() =>
      catalogSchema.parse({ formatVersion: 1, systems: [{ id: "x", name: "X", repository: "https://evil.test/x" }] })
    ).toThrow();
  });

  it("refuses an index written in a format this build does not know", () => {
    expect(() => catalogSchema.parse({ formatVersion: 2, systems: [] })).toThrow();
  });
});
