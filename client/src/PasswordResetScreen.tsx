import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api";

// The fragment is never sent in page requests or Referer headers.
const readResetToken = () => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";

export function PasswordResetScreen() {
  const [token, setToken] = useState(readResetToken);

  useEffect(() => {
    const changed = () => setToken(readResetToken());
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);

  // Another link to this path changes only the fragment. Start a fresh form so
  // the account, draft password, and request token always belong to that link.
  return <PasswordResetForm key={token} resetToken={token} />;
}

function PasswordResetForm({ resetToken }: { resetToken: string }) {
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api<{ username: string }>("/api/password-reset/open", {
      method: "POST",
      body: JSON.stringify({ token: resetToken })
    })
      .then((result) => setUsername(result.username))
      .catch((cause: Error) => setError(cause.message));
  }, [resetToken]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("password") !== form.get("confirm")) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/password-reset", {
        method: "POST",
        body: JSON.stringify({ token: resetToken, password: form.get("password") })
      });
      // A save for the previous link must not erase a newer link's fragment.
      if (readResetToken() !== resetToken) return;
      window.history.replaceState({}, "", "/reset-password");
      setDone(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen invite-screen">
      <section className="auth-panel">
        <p className="eyebrow">Password reset</p>
        <h1 className="invite-title">{done ? "Password saved" : "Set your password"}</h1>
        {done ? (
          <>
            <p>
              Sign in as <strong>{username}</strong> with your new password.
            </p>
            <a className="primary-button" href="/">
              Continue to sign in
            </a>
          </>
        ) : (
          <>
            {!username && !error && <p>Opening your reset link…</p>}
            {username && (
              <form onSubmit={save}>
                <p>
                  Choose a new password for <strong>{username}</strong>.
                </p>
                <p>14–128 characters. No required capitals, numbers, or symbols.</p>
                <label>
                  New password
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={14}
                    maxLength={128}
                    required
                    autoFocus
                  />
                </label>
                <label>
                  Confirm password
                  <input
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    minLength={14}
                    maxLength={128}
                    required
                  />
                </label>
                <button className="primary-button" disabled={busy}>
                  {busy ? "Saving…" : "Save password"}
                </button>
              </form>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {!username && error && <a href="/">Return to sign in</a>}
          </>
        )}
      </section>
    </main>
  );
}
