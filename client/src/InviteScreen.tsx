import { useEffect, useState, type FormEvent } from "react";
import type { Account, SystemId } from "@devils-toys/shared";
import { api } from "./api";

interface InvitationDetail {
  username: string;
  roomName: string;
  system: SystemId;
  expiresAt: string;
  status: "pending" | "redeemed" | "revoked" | "expired";
}

const statusCopy: Record<Exclude<InvitationDetail["status"], "pending">, string> = {
  redeemed: "This invitation has already been used.",
  revoked: "This invitation was revoked by the GM.",
  expired: "This invitation has expired. Ask the GM for a new one."
};

export function InviteScreen({ token, onSuccess }: { token: string; onSuccess: (account: Account) => void }) {
  const [invitation, setInvitation] = useState<InvitationDetail>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ invitation: InvitationDetail }>(`/api/invitations/${encodeURIComponent(token)}`)
      .then((result) => setInvitation(result.invitation))
      .catch((cause: Error) => setError(cause.message));
  }, [token]);

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ account: Account }>(`/api/invitations/${encodeURIComponent(token)}/redeem`, {
        method: "POST",
        body: JSON.stringify({ password: form.get("password") })
      });
      window.history.replaceState({}, "", "/");
      onSuccess(result.account);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen invite-screen">
      <div className="auth-atmosphere" aria-hidden="true">
        <span className="orbit orbit-one" />
        <span className="orbit orbit-two" />
        <div className="sun-mark">✦</div>
      </div>
      <section className="auth-panel">
        <p className="eyebrow">Player invitation</p>
        {!invitation && !error && <p className="auth-intro">Reading your invitation…</p>}
        {invitation && (
          <>
            <h1 className="invite-title">Join {invitation.roomName}</h1>
            <p className="auth-intro">
              You have been invited as <strong>{invitation.username}</strong> to a {invitation.system} table.
            </p>
            {invitation.status === "pending" ? (
              <form onSubmit={redeem}>
                <label>
                  Choose a password
                  <input name="password" type="password" autoComplete="new-password" minLength={8} required autoFocus />
                </label>
                <small className="invite-expiry">Link expires {new Date(invitation.expiresAt).toLocaleString()}.</small>
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                <button className="primary-button" disabled={busy}>
                  {busy ? "Joining…" : "Join the table"}
                </button>
              </form>
            ) : (
              <div className="invite-state">
                <p>{statusCopy[invitation.status]}</p>
                <a className="primary-button" href="/">
                  Return to sign in
                </a>
              </div>
            )}
          </>
        )}
        {!invitation && error && (
          <div className="invite-state">
            <h1 className="invite-title">Invitation unavailable</h1>
            <p className="form-error" role="alert">
              {error}
            </p>
            <a className="primary-button" href="/">
              Return to sign in
            </a>
          </div>
        )}
      </section>
    </main>
  );
}
