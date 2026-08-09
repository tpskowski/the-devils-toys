import { describe, expect, it } from "vitest";
import {
  helpDocumentHref,
  helpHeading,
  helpImageSrc,
  helpPath,
  helpTargetFromPath,
  isHelpPath,
  resolveHelpHref
} from "./help";

describe("help addresses", () => {
  it("links to the reader's own guide when none is named", () => {
    expect(helpPath()).toBe("/help");
  });

  it("names a guide and a page", () => {
    expect(helpPath("gm")).toBe("/help/gm");
    expect(helpPath("gm", "room-config")).toBe("/help/gm/room-config");
    // The overview is the guide's front page, not a page beneath it.
    expect(helpPath("admin", "overview")).toBe("/help/admin");
  });

  it("recognises its own paths and nothing else", () => {
    expect(isHelpPath("/help")).toBe(true);
    expect(isHelpPath("/help/gm")).toBe(true);
    expect(isHelpPath("/help/gm/combat")).toBe(true);
    expect(isHelpPath("/helper")).toBe(false);
    expect(isHelpPath("/")).toBe(false);
    expect(isHelpPath("/config")).toBe(false);
  });

  it("addresses the table editor's guide like any other", () => {
    expect(helpPath("tables")).toBe("/help/tables");
    expect(helpPath("tables", "tags")).toBe("/help/tables/tags");
    expect(helpTargetFromPath("/help/tables/tags")).toEqual({ guide: "tables", page: "tags" });
  });

  it("titles a guide with the application in front of it", () => {
    expect(helpHeading("Player's Guide")).toBe("The Devil’s Toys — Player's Guide");
    expect(helpHeading("Admin's Guide")).toBe("The Devil’s Toys — Admin's Guide");
  });

  it("leaves a guide that already carries the house name to stand alone", () => {
    // "The Devil's Toys — The Devil's Tables" reads like a stutter.
    expect(helpHeading("The Devil’s Tables")).toBe("The Devil’s Tables");
    expect(helpHeading("The Devil's Tables")).toBe("The Devil's Tables");
  });

  it("reads the guide and page back out of an address", () => {
    expect(helpTargetFromPath("/help")).toEqual({});
    expect(helpTargetFromPath("/help/gm")).toEqual({ guide: "gm", page: undefined });
    expect(helpTargetFromPath("/help/gm/room-config")).toEqual({ guide: "gm", page: "room-config" });
    expect(helpTargetFromPath("/help/gm/")).toEqual({ guide: "gm", page: undefined });
  });

  it("treats a guide it does not have as no guide at all", () => {
    expect(helpTargetFromPath("/help/wizard")).toEqual({});
    expect(helpTargetFromPath("/help/wizard/spells")).toEqual({});
  });
});

describe("links written between the guide's own files", () => {
  it("keeps a plain link inside the guide it was written in", () => {
    expect(resolveHelpHref("combat.md", "player")).toEqual({ guide: "player", page: "combat", hash: "" });
    expect(resolveHelpHref("room-config.md", "gm")).toEqual({ guide: "gm", page: "room-config", hash: "" });
  });

  it("reads a README as the guide's overview", () => {
    expect(resolveHelpHref("README.md", "gm")).toEqual({ guide: "gm", page: "overview", hash: "" });
  });

  it("follows a link out of one guide into another", () => {
    // The GM guide points at the admin guide as "../admin/rooms.md".
    expect(resolveHelpHref("../admin/rooms.md", "gm")).toEqual({ guide: "admin", page: "rooms", hash: "" });
    // And back to the player guide, which is the root directory.
    expect(resolveHelpHref("../README.md", "gm")).toEqual({ guide: "player", page: "overview", hash: "" });
    // The player guide points down into the others.
    expect(resolveHelpHref("gm/README.md", "player")).toEqual({ guide: "gm", page: "overview", hash: "" });
  });

  it("carries a fragment across with the page", () => {
    expect(resolveHelpHref("../admin/rooms.md#who-a-rooms-gm-is", "gm")).toEqual({
      guide: "admin",
      page: "rooms",
      hash: "who-a-rooms-gm-is"
    });
  });

  it("reads a link to the table editor's guide as that guide, from any depth", () => {
    // It is one document that is a whole guide, so it is recognised by name
    // rather than resolved as a path out of the guide tree.
    expect(resolveHelpHref("../../devils-tables.md", "player")).toEqual({
      guide: "tables",
      page: "overview",
      hash: ""
    });
    expect(resolveHelpHref("../../../devils-tables.md", "gm")).toEqual({
      guide: "tables",
      page: "overview",
      hash: ""
    });
    expect(resolveHelpHref("../../../devils-tables.md", "admin")).toEqual({
      guide: "tables",
      page: "overview",
      hash: ""
    });
  });

  it("still sends the licensing notice to the document itself", () => {
    expect(helpDocumentHref("../../../NOTICE.md")).toBe("/api/project/notice");
    expect(helpDocumentHref("combat.md")).toBeUndefined();
  });

  it("serves an image from beside the guides, whatever depth it was written at", () => {
    expect(helpImageSrc("images/the-table.png")).toBe("/api/help/images/the-table.png");
    expect(helpImageSrc("../images/gm-invite.png")).toBe("/api/help/images/gm-invite.png");
  });
});
