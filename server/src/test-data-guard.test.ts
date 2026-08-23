import { describe, expect, it } from "vitest";
import { markTestDatabaseIsolated, refuseUnisolatedTestDatabase } from "./test-data-guard.js";

describe("test database isolation guard", () => {
  it("refuses Vitest before the isolation setup marks the process", () => {
    expect(() => refuseUnisolatedTestDatabase({ VITEST: "true" })).toThrow(/running without server\/src\/test-setup/);
  });

  it("allows an isolated Vitest process", () => {
    const environment: NodeJS.ProcessEnv = { VITEST: "true" };
    markTestDatabaseIsolated(environment);
    expect(() => refuseUnisolatedTestDatabase(environment)).not.toThrow();
  });

  it("does not affect an ordinary server process", () => {
    expect(() => refuseUnisolatedTestDatabase({})).not.toThrow();
  });
});
