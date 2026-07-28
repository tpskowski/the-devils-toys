import crypto from "node:crypto";

export interface InvitationTimestamps {
  expires_at: string;
  redeemed_at: string | null;
  revoked_at: string | null;
}

export function invitationTokenHash(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function invitationStatus(
  invitation: InvitationTimestamps,
  now = Date.now()
): "pending" | "redeemed" | "revoked" | "expired" {
  if (invitation.redeemed_at) return "redeemed";
  if (invitation.revoked_at) return "revoked";
  if (new Date(invitation.expires_at).getTime() <= now) return "expired";
  return "pending";
}
