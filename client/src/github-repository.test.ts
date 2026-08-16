import { describe, expect, it } from "vitest";
import { parseRepositoryInput } from "./github-repository";

describe("reading a repository out of what was pasted", () => {
  it("takes the plain form the server wants", () => {
    expect(parseRepositoryInput("tpskowski/devils-toys-monolith")).toEqual({
      repository: "tpskowski/devils-toys-monolith"
    });
  });

  it("takes the address bar, which is what is actually on the clipboard", () => {
    for (const pasted of [
      "https://github.com/tpskowski/devils-toys-monolith",
      "http://github.com/tpskowski/devils-toys-monolith",
      "https://www.github.com/tpskowski/devils-toys-monolith",
      "github.com/tpskowski/devils-toys-monolith",
      "https://github.com/tpskowski/devils-toys-monolith/",
      "  https://github.com/tpskowski/devils-toys-monolith  "
    ]) {
      expect(parseRepositoryInput(pasted), pasted).toEqual({ repository: "tpskowski/devils-toys-monolith" });
    }
  });

  it("takes what the Code button offers", () => {
    expect(parseRepositoryInput("https://github.com/tpskowski/devils-toys-monolith.git")).toEqual({
      repository: "tpskowski/devils-toys-monolith"
    });
    expect(parseRepositoryInput("git@github.com:tpskowski/devils-toys-monolith.git")).toEqual({
      repository: "tpskowski/devils-toys-monolith"
    });
  });

  /** Browsing a tag and copying the address is how someone picks a version. */
  it("reads the ref out of an address that names one", () => {
    expect(parseRepositoryInput("https://github.com/owner/repo/tree/v1.2.0")).toEqual({
      repository: "owner/repo",
      ref: "v1.2.0"
    });
    expect(parseRepositoryInput("https://github.com/owner/repo/tree/release/1.2")).toEqual({
      repository: "owner/repo",
      ref: "release/1.2"
    });
    expect(parseRepositoryInput("https://github.com/owner/repo/commit/4f1c2ab")).toEqual({
      repository: "owner/repo",
      ref: "4f1c2ab"
    });
  });

  it("keeps the repository but names no ref for a page that is not one", () => {
    // A file's address says which branch it was read on, but someone pasting it
    // meant the repository, not that branch. Guessing would install a ref they
    // never chose.
    expect(parseRepositoryInput("https://github.com/owner/repo/blob/main/README.md")).toEqual({
      repository: "owner/repo"
    });
    expect(parseRepositoryInput("https://github.com/owner/repo/issues/7")).toEqual({ repository: "owner/repo" });
  });

  it("refuses what it cannot be sure of", () => {
    for (const rubbish of [
      "",
      "   ",
      "not-a-repository",
      "owner/repo/extra",
      "https://gitlab.com/owner/repo",
      "https://example.test/owner/repo",
      "../../etc/passwd",
      "owner/",
      "/repo",
      "owner/re po"
    ]) {
      expect(parseRepositoryInput(rubbish), rubbish).toBeUndefined();
    }
  });
});
