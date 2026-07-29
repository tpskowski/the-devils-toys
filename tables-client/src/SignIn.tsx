import { useEffect, useState } from "react";
import type { Account } from "@devils-toys/shared";
import { api } from "./api";

/**
 * The same credentials as The Devil's Toys, because both applications read the
 * same accounts table and share a session cookie. Accounts are created there.
 */
export function SignIn({ onSignedIn }: { onSignedIn: (account: Account) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [initialized, setInitialized] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ initialized: boolean }>("/api/status")
      .then((status) => setInitialized(status.initialized))
      .catch(() => setInitialized(true));
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ account: Account }>("/api/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });
      onSignedIn(result.account);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="signin">
      <form onSubmit={submit}>
        <h1>The Devil&rsquo;s Tables</h1>
        <p className="signin-tagline">Write, tag, and share the random tables your games roll on.</p>
        {initialized ? null : (
          <p className="empty-note">
            No accounts exist yet. Set up The Devil&rsquo;s Toys first; this editor signs in with the same account.
          </p>
        )}
        <label>
          Username
          <input value={username} autoComplete="username" onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="primary-button" disabled={busy || !username || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
