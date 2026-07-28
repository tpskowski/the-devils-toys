import { describe, expect, it } from "vitest";
import { canResetAccountPassword } from "./account-permissions.js";

describe("account password permissions", () => {
  it("does not let a GM reset a server admin password", () => {
    expect(canResetAccountPassword(false, true, true)).toBe(false);
  });

  it("lets a GM reset a managed player password", () => {
    expect(canResetAccountPassword(false, false, true)).toBe(true);
  });

  it("does not let a GM reset an unrelated player password", () => {
    expect(canResetAccountPassword(false, false, false)).toBe(false);
  });

  it("lets a server admin reset account passwords", () => {
    expect(canResetAccountPassword(true, true, false)).toBe(true);
    expect(canResetAccountPassword(true, false, false)).toBe(true);
  });
});
