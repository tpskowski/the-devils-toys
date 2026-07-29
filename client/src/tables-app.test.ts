import { describe, expect, it } from "vitest";
import { tablesAppUrl } from "./tables-app";

const origin = { protocol: "http:", hostname: "localhost" };

describe("finding The Devil's Tables", () => {
  it("uses this host on the editor's own port", () => {
    expect(tablesAppUrl({ url: "", port: 4100 }, origin)).toBe("http://localhost:4100");
  });

  it("keeps the scheme and host the game was reached on", () => {
    expect(tablesAppUrl({ url: "", port: 4100 }, { protocol: "https:", hostname: "table.example" })).toBe(
      "https://table.example:4100"
    );
  });

  it("prefers an explicit address, which is how a reverse proxy moves it", () => {
    expect(tablesAppUrl({ url: "https://tables.example/", port: 4100 }, origin)).toBe("https://tables.example/");
  });

  it("uses the editor's dev server in development, not the API port", () => {
    expect(tablesAppUrl({ url: "", port: 4100 }, origin, 10667)).toBe("http://localhost:10667");
  });

  it("still honours an explicit address in development", () => {
    expect(tablesAppUrl({ url: "https://tables.example", port: 4100 }, origin, 10667)).toBe("https://tables.example");
  });

  it("offers nothing when the server has not said where it is", () => {
    expect(tablesAppUrl(undefined, origin)).toBe("");
  });
});
