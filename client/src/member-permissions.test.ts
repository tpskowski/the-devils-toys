import { describe, expect, it } from "vitest";
import { canShowPasswordReset } from "./member-permissions";

describe("member management permissions", () => {
  it("hides admin password resets from GMs", () => {
    expect(canShowPasswordReset(false, true)).toBe(false);
  });

  it("shows player password resets to GMs", () => {
    expect(canShowPasswordReset(false, false)).toBe(true);
  });

  it("shows password resets to server admins", () => {
    expect(canShowPasswordReset(true, true)).toBe(true);
  });
});
