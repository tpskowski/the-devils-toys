import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("API errors", () => {
  it("keeps a structured refusal available to the caller", async () => {
    const payload = {
      code: "breaking_system_change",
      error: "This release changes existing rooms.",
      change: { fingerprint: "release-123" }
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => payload } as Response)
    );

    await expect(api("/api/admin/systems/import")).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      message: payload.error,
      payload
    } satisfies Partial<ApiError>);
  });
});
