import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { mapLegendForSelection, TableMediaViewer } from "./TableMediaViewer";

function renderViewer(wikiEnabled: boolean) {
  return renderToStaticMarkup(
    createElement(TableMediaViewer, {
      roomId: 1,
      accountId: 1,
      media: { map: null, scene: null, references: [], library: [] },
      isGm: true,
      pings: [],
      encounterEnabled: false,
      onManage() {},
      onPing() {},
      mapNotationEnabled: false,
      mapNotationSyncRevision: 0,
      wikiEnabled,
      wikiRevision: 0,
      rulesPage: createElement("div")
    })
  );
}

describe("map legend selection", () => {
  it("does not dereference an empty active map when the Maps tab has no map", () => {
    expect(mapLegendForSelection(null, undefined)).toBeNull();
  });
});

describe("main table tabs", () => {
  it("shows Wiki as a primary tab only when the room enables it", () => {
    expect(renderViewer(true)).toContain('aria-label="Wiki"');
    expect(renderViewer(false)).not.toContain('aria-label="Wiki"');
  });
});
