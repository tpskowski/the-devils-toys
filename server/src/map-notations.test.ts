import { describe, expect, it } from "vitest";
import { mapNotationSchema } from "./map-notations.js";

describe("map notation labels", () => {
  it("accepts a drag-sized multiline text box", () => {
    expect(
      mapNotationSchema.safeParse({
        kind: "label",
        color: "#f5f5f5",
        x: 0.1,
        y: 0.2,
        width: 0.35,
        height: 0.15,
        text: "Deck 1\nAirlock",
        fontSize: 12
      }).success
    ).toBe(true);
  });

  it("keeps labels created before text boxes compatible", () => {
    expect(
      mapNotationSchema.safeParse({
        kind: "label",
        color: "#f5f5f5",
        x: 0.1,
        y: 0.2,
        text: "Airlock",
        fontSize: 12
      }).success
    ).toBe(true);
  });
});
