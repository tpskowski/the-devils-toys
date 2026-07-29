import { useState } from "react";
import { Check, Copy, RefreshCw, X } from "lucide-react";

/**
 * What to do when the editor is not running. It is a separate process by
 * design — that is what lets it be restarted without disturbing a game — so the
 * honest answer to a dead link is the command that starts it.
 */
export function TablesAppDialog({
  command,
  url,
  checking,
  onRecheck,
  onClose
}: {
  command: string;
  url: string;
  checking: boolean;
  onRecheck: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // A browser that refuses the clipboard still shows the command to read.
    }
  }

  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="modal tables-app-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Start The Devil's Tables"
      >
        <header>
          <p className="eyebrow">Not running</p>
          <h2>The Devil&rsquo;s Tables</h2>
          <button onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="tables-app-body">
          <p className="modal-intro">
            The table editor runs as its own process, so it can be started and stopped without touching a game in
            progress. Nothing is running at <code>{url}</code> yet. Start it from a terminal in the project directory:
          </p>

          <div className="tables-app-command">
            <code>{command}</code>
            <button type="button" onClick={copy} title="Copy the command">
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <p className="empty-note">
            It shares this server&rsquo;s database and sign-in, and leaving it stopped costs a game nothing.
          </p>

          <div className="tables-app-actions">
            <button type="button" onClick={onRecheck} disabled={checking}>
              <RefreshCw size={15} /> {checking ? "Checking…" : "Check again"}
            </button>
            <a className="primary-button" href={url} target="_blank" rel="noreferrer">
              Open it anyway
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
