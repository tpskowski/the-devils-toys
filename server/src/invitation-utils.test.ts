import { describe, expect, it } from "vitest";
import { invitationStatus, invitationTokenHash } from "./invitation-utils.js";

describe("invitation utilities", () => {
  it("hashes tokens without retaining the raw secret", () => {
    const hash = invitationTokenHash("single-use-secret");
    expect(hash).toHaveLength(64);
    expect(hash).toBe(invitationTokenHash("single-use-secret"));
    expect(hash).not.toContain("single-use-secret");
  });

  it("distinguishes pending and expired invitations", () => {
    expect(
      invitationStatus(
        { expires_at: "2026-01-02T00:00:00.000Z", redeemed_at: null, revoked_at: null },
        Date.parse("2026-01-01")
      )
    ).toBe("pending");
    expect(
      invitationStatus(
        { expires_at: "2026-01-01T00:00:00.000Z", redeemed_at: null, revoked_at: null },
        Date.parse("2026-01-02")
      )
    ).toBe("expired");
  });

  it("reports terminal states before expiry", () => {
    const expired = "2020-01-01T00:00:00.000Z";
    expect(invitationStatus({ expires_at: expired, redeemed_at: "2020-01-01", revoked_at: null })).toBe("redeemed");
    expect(invitationStatus({ expires_at: expired, redeemed_at: null, revoked_at: "2020-01-01" })).toBe("revoked");
  });
});
