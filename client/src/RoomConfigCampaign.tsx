import { useRef, useState, type ChangeEvent } from "react";
import { Download, FileUp, TriangleAlert } from "lucide-react";
import { api } from "./api";

/**
 * Importing a prepared campaign into this room, and writing this room back out
 * as one.
 *
 * Two steps, deliberately. The upload is staged and read, and what comes back
 * says what confirming it would land; nothing is written until the GM says so.
 * The panel's whole job is to make that first answer readable — counts, the
 * megabytes against what is left, and every warning the reader raised — so that
 * pressing the button is a decision rather than a hope.
 */

type ConflictPolicy = "skip" | "replace" | "add";

interface KindCount {
  kind: string;
  new: number;
  conflict: number;
}

interface Preview {
  token: string;
  campaign: { campaignId: string; name: string; version: string; system: string };
  systemMatch: "exact" | "agnostic";
  overview: string;
  bytes: { incoming: number; remaining: number };
  kinds: KindCount[];
  calendar: boolean;
  previous?: { name: string; version: string; importedAt: string };
  guessed: string[];
  warnings: string[];
}

interface Tally {
  added: number;
  replaced: number;
  skipped: number;
  unchanged: number;
}

interface ImportResult {
  campaign: string;
  media: Tally;
  playlists: Tally;
  npcs: Tally;
  encounters: Tally;
  tables: Tally;
  items: Tally;
  group: Tally;
  room: string[];
  bytes: number;
  skipped: string[];
}

const KIND_LABELS: Record<string, string> = {
  maps: "Maps",
  scenes: "Scenes",
  references: "References",
  audio: "Music",
  playlists: "Playlists",
  npcs: "NPCs",
  encounters: "Encounters",
  tables: "Table sets",
  items: "Items",
  hirelings: "Hirelings",
  assets: "Group assets",
  obligations: "Obligations"
};

/**
 * The unit is chosen from the number as it will be **rounded**, not as it is.
 * An allowance a hundred bytes short of a gigabyte otherwise reads "1024.0 MB",
 * which is exactly the number a GM sees when their server is nearly empty.
 */
function formatSize(bytes: number) {
  for (const [suffix, size, digits] of [
    ["GB", 1024 ** 3, 2],
    ["MB", 1024 ** 2, 1],
    ["KB", 1024, 0]
  ] as const) {
    const value = bytes / size;
    if (Number(value.toFixed(digits)) >= 1) return `${value.toFixed(digits)} ${suffix}`;
  }
  return `${bytes} B`;
}

/** What actually happened, said in the order a GM would ask about it. */
function tallyLine(label: string, tally: Tally) {
  const parts = [
    tally.added && `${tally.added} added`,
    tally.replaced && `${tally.replaced} updated`,
    tally.unchanged && `${tally.unchanged} already here`,
    tally.skipped && `${tally.skipped} left alone`
  ].filter(Boolean);
  return parts.length ? `${label}: ${parts.join(", ")}.` : "";
}

export function RoomConfigCampaign({ roomId, onImported }: { roomId: number; onImported: () => void }) {
  const [preview, setPreview] = useState<Preview>();
  const [result, setResult] = useState<ImportResult>();
  const [policy, setPolicy] = useState<ConflictPolicy>("skip");
  const [takeRoomSettings, setTakeRoomSettings] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const conflicts = (preview?.kinds ?? []).reduce((total, kind) => total + kind.conflict, 0);
  const fits = !preview || preview.bytes.incoming <= preview.bytes.remaining;

  async function stage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setResult(undefined);
    setBusy("Reading the campaign…");
    try {
      const body = new FormData();
      body.append("campaign", file);
      setPreview(await api<Preview>(`/api/rooms/${roomId}/campaign/stage`, { method: "POST", body }));
    } catch (cause) {
      setPreview(undefined);
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function confirm() {
    if (!preview) return;
    setBusy("Importing…");
    setError("");
    try {
      const imported = await api<ImportResult>(`/api/rooms/${roomId}/campaign/${preview.token}/apply`, {
        method: "POST",
        body: JSON.stringify({ policy, takeRoomSettings })
      });
      setResult(imported);
      setPreview(undefined);
      onImported();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function discard() {
    if (!preview) return;
    const { token } = preview;
    setPreview(undefined);
    // The stage would be reaped on its own; letting go of it now is tidier and
    // costs one request nobody waits on.
    await api(`/api/rooms/${roomId}/campaign/${token}`, { method: "DELETE" }).catch(() => undefined);
  }

  return (
    <div className="campaign-panel">
      <h3>Campaign</h3>

      {!preview && (
        <>
          <p className="campaign-lead">
            A campaign is a zip of labelled folders — <code>maps</code>, <code>scenes</code>, <code>npcs</code>, and the
            rest. Everything in it lands in this room, and you see what it would do before it does.
          </p>
          <div className="campaign-actions">
            <button type="button" disabled={Boolean(busy)} onClick={() => fileInput.current?.click()}>
              <FileUp size={16} aria-hidden /> Import a campaign
            </button>
            <a className="campaign-export" href={`/api/rooms/${roomId}/campaign/export`} download>
              <Download size={16} aria-hidden /> Export this room
            </a>
          </div>
          <input ref={fileInput} type="file" accept=".zip" hidden onChange={stage} />
        </>
      )}

      {busy && <p className="campaign-busy">{busy}</p>}
      {error && <p className="campaign-error">{error}</p>}

      {preview && (
        <div className="campaign-preview">
          <h4>
            {preview.campaign.name}
            {preview.campaign.version && <span className="campaign-version"> {preview.campaign.version}</span>}
          </h4>
          {preview.previous && (
            <p className="campaign-previous">
              This room last took {preview.previous.name}
              {preview.previous.version && ` ${preview.previous.version}`} on{" "}
              {new Date(preview.previous.importedAt).toLocaleDateString()}. What it left will be brought up to date;
              anything you have changed since stays as you left it.
            </p>
          )}

          <table className="campaign-kinds">
            <thead>
              <tr>
                <th scope="col">What</th>
                <th scope="col">New</th>
                <th scope="col">Already here</th>
              </tr>
            </thead>
            <tbody>
              {preview.kinds.map((kind) => (
                <tr key={kind.kind}>
                  <th scope="row">{KIND_LABELS[kind.kind] ?? kind.kind}</th>
                  <td>{kind.new}</td>
                  <td>{kind.conflict || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className={fits ? "campaign-bytes" : "campaign-bytes campaign-error"}>
            {formatSize(preview.bytes.incoming)} to store, and {formatSize(preview.bytes.remaining)} left in this
            server’s allowance.
            {!fits && " It will not fit: free some space, or split the campaign into parts."}
          </p>

          {preview.guessed.map((line) => (
            <p key={line} className="campaign-guessed">
              {line}
            </p>
          ))}
          {preview.warnings.map((line) => (
            <p key={line} className="campaign-warning">
              <TriangleAlert size={14} aria-hidden /> {line}
            </p>
          ))}

          {conflicts > 0 && (
            <fieldset className="campaign-policy">
              <legend>
                {conflicts} thing{conflicts === 1 ? "" : "s"} here already
              </legend>
              {(
                [
                  ["skip", "Leave what is here alone"],
                  ["replace", "Let the campaign overwrite it"],
                  ["add", "Add the campaign’s beside it"]
                ] as const
              ).map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="campaign-policy"
                    value={value}
                    checked={policy === value}
                    onChange={() => setPolicy(value)}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          )}

          <label className="campaign-room-settings">
            <input
              type="checkbox"
              checked={takeRoomSettings}
              onChange={(event) => setTakeRoomSettings(event.target.checked)}
            />
            Also take this campaign’s room name, theme{preview.calendar ? ", calendar" : ""} and switches
          </label>

          <div className="campaign-actions">
            <button type="button" disabled={Boolean(busy) || !fits} onClick={confirm}>
              Import into this room
            </button>
            <button type="button" className="campaign-secondary" disabled={Boolean(busy)} onClick={discard}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="campaign-result">
          <h4>{result.campaign} imported</h4>
          <ul>
            {[
              tallyLine("Library", result.media),
              tallyLine("Playlists", result.playlists),
              tallyLine("NPCs", result.npcs),
              tallyLine("Encounters", result.encounters),
              tallyLine("Items", result.items),
              tallyLine("The party", result.group),
              tallyLine("Table sets", result.tables)
            ]
              .filter(Boolean)
              .map((line) => (
                <li key={line}>{line}</li>
              ))}
            {result.room.length > 0 && <li>The room was {result.room.join(", ")}.</li>}
          </ul>
          {result.skipped.length > 0 && (
            <>
              <p className="campaign-warning">
                <TriangleAlert size={14} aria-hidden /> Some of it could not land here:
              </p>
              <ul className="campaign-skipped">
                {result.skipped.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
