import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  ExternalLink,
  Images,
  ListMusic,
  Rocket,
  Settings2,
  Swords,
  UserRound,
  UsersRound
} from "lucide-react";
import type {
  RoomConfigPayload,
  RoomConfigRoom,
  RoomConfigSection,
  RoomConfigSectionId,
  RoomConfigToggle
} from "@devils-toys/shared";
import { api } from "./api";
import { roomConfigPath, roomIdFromConfigSearch, sectionFromHash, sectionStorageKey } from "./room-config";
import { RoomConfigCalendar } from "./RoomConfigCalendar";
import { RoomConfigItems } from "./RoomConfigItems";
import { RoomConfigLibrary } from "./RoomConfigLibrary";
import { RoomConfigNpcs } from "./RoomConfigNpcs";
import { RoomConfigPlaylists } from "./RoomConfigPlaylists";
import { RoomConfigRoster } from "./RoomConfigRoster";
import "./room-config.css";

const sectionIcons: Record<RoomConfigSectionId, typeof Images> = {
  library: Images,
  npcs: UserRound,
  items: Swords,
  calendar: CalendarDays,
  playlists: ListMusic,
  hirelings: UsersRound,
  assets: Rocket
};

const toggleLabels: Record<RoomConfigToggle, string> = {
  calendarEnabled: "Enable the calendar for this room",
  musicEnabled: "Enable music for this room"
};

export function RoomConfigPage() {
  const [roomId, setRoomId] = useState(() => roomIdFromConfigSearch(window.location.search));
  const [rooms, setRooms] = useState<RoomConfigRoom[]>();
  const [config, setConfig] = useState<RoomConfigPayload>();
  const [section, setSection] = useState<RoomConfigSectionId>();
  const [error, setError] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const [busy, setBusy] = useState(false);
  // Bumped whenever the room reports a change, so each section refetches its own
  // data rather than the shell knowing what any of them holds.
  const [revision, setRevision] = useState(0);

  const loadRooms = useCallback(async () => {
    try {
      const result = await api<{ rooms: RoomConfigRoom[] }>("/api/room-config/rooms");
      setRooms(result.rooms);
    } catch (cause) {
      const message = (cause as Error).message;
      if (message === "Sign in required.") setSignedOut(true);
      else setError(message);
      setRooms([]);
    }
  }, []);

  const loadConfig = useCallback(async (id: number) => {
    try {
      setConfig(await api<RoomConfigPayload>(`/api/room-config/${id}`));
      setError("");
    } catch (cause) {
      const message = (cause as Error).message;
      if (message === "Sign in required.") setSignedOut(true);
      else setError(message);
      setConfig(undefined);
    }
  }, []);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  useEffect(() => {
    if (roomId === undefined) {
      setConfig(undefined);
      return;
    }
    loadConfig(roomId);
  }, [roomId, loadConfig]);

  // The address is the panel's memory of which room it is on, so a reload and a
  // shared link both land in the same place.
  const openRoom = useCallback((id: number | undefined) => {
    setRoomId(id);
    window.history.replaceState(null, "", roomConfigPath(id));
  }, []);

  // Which section a room was left on, so returning to it does not start over.
  useEffect(() => {
    if (!config) return;
    const available = config.sections.filter((entry) => entry.enabled);
    const remembered = window.localStorage.getItem(sectionStorageKey(config.room.id)) ?? "";
    const wanted = sectionFromHash(window.location.hash) ?? sectionFromHash(remembered);
    setSection(
      (current) =>
        available.find((entry) => entry.id === current)?.id ??
        available.find((entry) => entry.id === wanted)?.id ??
        available[0]?.id ??
        config.sections[0]?.id
    );
  }, [config]);

  useEffect(() => {
    if (config && section) window.localStorage.setItem(sectionStorageKey(config.room.id), section);
  }, [config, section]);

  const theme = config?.room.theme ?? "heroic";
  useEffect(() => {
    document.title = config ? `${config.room.name} · Room Config` : "Room Config";
  }, [config]);

  useRoomWatch(roomId, () => {
    setRevision((current) => current + 1);
    if (roomId !== undefined) loadConfig(roomId);
  });

  async function setToggle(toggle: RoomConfigToggle, value: boolean) {
    if (!config) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/rooms/${config.room.id}`, { method: "PATCH", body: JSON.stringify({ [toggle]: value }) });
      await loadConfig(config.room.id);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (signedOut)
    return (
      <main className={`room-config theme-${theme}`}>
        <div className="room-config-empty">
          <h1>Room Config</h1>
          <p>Sign in to The Devil’s Toys first, then open this page again.</p>
          <a className="room-config-link" href="/">
            Go to The Devil’s Toys <ExternalLink size={14} />
          </a>
        </div>
      </main>
    );

  if (roomId === undefined || !config)
    return (
      <main className={`room-config theme-${theme}`}>
        <div className="room-config-selector">
          <header>
            <p className="room-config-eyebrow">The Devil’s Toys</p>
            <h1>Room Config</h1>
            <p className="room-config-lede">
              The wide version of the room’s own controls: its library, its cast, its gear, and everything else it owns.
              Choose a room to configure.
            </p>
          </header>
          {error && <p className="room-config-error">{error}</p>}
          {rooms === undefined ? (
            <p className="room-config-muted">Loading rooms…</p>
          ) : rooms.length === 0 ? (
            <p className="room-config-muted">You do not run any rooms yet.</p>
          ) : (
            <ul className="room-config-room-list">
              {rooms.map((room) => (
                <li key={room.id}>
                  <button type="button" onClick={() => openRoom(room.id)}>
                    <span className="room-config-room-name">
                      {room.name}
                      {room.archived && <em>Archived</em>}
                    </span>
                    <small>
                      {room.system}
                      {room.access === "admin" && " · as admin"}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    );

  const current = config.sections.find((entry) => entry.id === section);

  return (
    <main className={`room-config room-config-open theme-${theme}`}>
      <aside className="room-config-rail">
        <button type="button" className="room-config-switcher" onClick={() => openRoom(undefined)}>
          <Settings2 size={16} />
          <span>
            {config.room.name}
            <small>{config.room.archived ? "Archived · switch room" : "Switch room"}</small>
          </span>
        </button>
        <nav aria-label="Configuration sections">
          {config.sections.map((entry) => {
            const Icon = sectionIcons[entry.id];
            return (
              <button
                key={entry.id}
                type="button"
                className={`room-config-section-button${entry.id === section ? " is-current" : ""}${
                  entry.enabled ? "" : " is-off"
                }`}
                onClick={() => setSection(entry.id)}
              >
                <Icon size={17} />
                <span>
                  {entry.label}
                  <small>{entry.enabled ? entry.hint : "Switched off"}</small>
                </span>
              </button>
            );
          })}
        </nav>
        <footer>
          <span className="room-config-badge">{config.room.access === "admin" ? "Server admin" : "Game master"}</span>
          <a className="room-config-link" href="/" target="_blank" rel="noreferrer">
            Open the room <ExternalLink size={13} />
          </a>
        </footer>
      </aside>
      <section className="room-config-body">
        <header className="room-config-header">
          <div>
            <p className="room-config-eyebrow">
              {config.system.name} · {config.room.name}
            </p>
            <h1>{current?.label ?? "Room Config"}</h1>
            <p className="room-config-lede">{current?.hint}</p>
          </div>
          <span className="room-config-glyph" aria-hidden="true">
            {config.system.glyph}
          </span>
        </header>
        {error && <p className="room-config-error">{error}</p>}
        {current && !current.enabled && current.enabledBy ? (
          <div className="room-config-panel room-config-off">
            <p>
              {current.label} is switched off for {config.room.name}. Turning it on here is the same switch the room’s
              settings carry.
            </p>
            <button type="button" disabled={busy} onClick={() => setToggle(current.enabledBy!, true)}>
              {toggleLabels[current.enabledBy]}
            </button>
          </div>
        ) : current?.id === "library" ? (
          <div className="room-config-section">
            <RoomConfigLibrary roomId={config.room.id} revision={revision} />
          </div>
        ) : current?.id === "npcs" ? (
          <div className="room-config-section">
            <RoomConfigNpcs room={config.room} system={config.system} revision={revision} />
          </div>
        ) : current?.id === "calendar" ? (
          <div className="room-config-section">
            <RoomConfigCalendar
              roomId={config.room.id}
              calendar={config.calendar}
              onSaved={(calendar) => setConfig((held) => (held ? { ...held, calendar } : held))}
            />
          </div>
        ) : current?.id === "playlists" ? (
          <div className="room-config-section">
            <RoomConfigPlaylists roomId={config.room.id} revision={revision} />
          </div>
        ) : current?.id === "items" ? (
          <div className="room-config-section">
            <RoomConfigItems room={config.room} system={config.system} revision={revision} />
          </div>
        ) : current?.id === "hirelings" || current?.id === "assets" ? (
          <div className="room-config-section">
            <RoomConfigRoster roomId={config.room.id} kind={current.id} revision={revision} />
          </div>
        ) : (
          current && <SectionPlaceholder section={current} />
        )}
      </section>
    </main>
  );
}

/**
 * Every section's home before the section itself is built. It says what will be
 * here rather than showing an empty frame, so the shell can be reviewed on its
 * own without reading as broken.
 */
function SectionPlaceholder({ section }: { section: RoomConfigSection }) {
  return (
    <div className="room-config-panel room-config-placeholder">
      <h2>{section.label}</h2>
      <p>{section.hint}.</p>
      <p className="room-config-muted">This section is not built yet.</p>
    </div>
  );
}

/**
 * Follow a room's changes without joining it. The panel watches rather than
 * joins, so having it open never puts anyone in the room's presence and never
 * posts a join notice — which matters most for the admin, who is not a member,
 * and for the GM, who may leave the table with this still open.
 */
function useRoomWatch(roomId: number | undefined, onChange: () => void) {
  const changed = useRef(onChange);
  changed.current = onChange;

  useEffect(() => {
    if (roomId === undefined) return;
    let stopped = false;
    let retry: number;
    let attempt = 0;
    let socket: WebSocket;
    const connect = () => {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${location.host}/ws`);
      socket.onopen = () => {
        attempt = 0;
        socket.send(JSON.stringify({ type: "watch", roomId }));
      };
      socket.onmessage = (event) => {
        let data: { type?: string };
        try {
          data = JSON.parse(event.data) as { type?: string };
        } catch {
          // A frame this page cannot read is not a change it has to act on.
          return;
        }
        if (typeof data.type === "string" && data.type.endsWith("-updated")) changed.current();
        if (data.type === "room-access-removed") changed.current();
      };
      socket.onclose = () => {
        // The panel is left open for hours at a time, so a server that has gone
        // away is backed off rather than asked every second and a half forever.
        if (stopped) return;
        attempt += 1;
        retry = window.setTimeout(connect, Math.min(1500 * 2 ** (attempt - 1), 30000));
      };
    };
    connect();
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      socket?.close();
    };
  }, [roomId]);
}
