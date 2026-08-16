import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from "react";
import {
  Archive,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  CircleUserRound,
  CornerDownRight,
  Dices,
  DoorOpen,
  Eye,
  FileText,
  LogOut,
  Map,
  Menu,
  MessageSquare,
  Music,
  ChevronRight,
  Plus,
  LifeBuoy,
  ScrollText,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Skull,
  RotateCcw,
  Table2,
  Trash2,
  UserPlus,
  UserRound,
  Library,
  UsersRound,
  Swords,
  X
} from "lucide-react";
import type {
  Account,
  CharacterSheetDefinition,
  ChatMessage,
  ItemTrait,
  DiceRules,
  MapNotationEvent,
  PresenceMember,
  RoomSummary,
  RoomCalendar,
  SystemId,
  ThemeId
} from "@devils-toys/shared";
import { api } from "./api";
import { tablesAppUrl, type TablesApp } from "./tables-app";
import { TablesAppDialog } from "./TablesAppDialog";
import { shouldSubmitChatOnEnter } from "./chat";
import { InlineMarkdown } from "./InlineMarkdown";
import type { AudioPlaybackState, RoomAudioState } from "@devils-toys/shared";
import { InviteScreen } from "./InviteScreen";
import { CharacterModal } from "./CharacterModal";
import { extractRuleTocHeadings, filterRules, rulesPath } from "./rules";
import { roomConfigPath } from "./room-config";
import { helpPath } from "./help";
import { MediaModal, type RoomMediaState } from "./MediaModal";
import { LibraryModal } from "./LibraryModal";
import { RulesMarkdown } from "./RulesMarkdown";
import type { ScenePing } from "./SceneViewer";
import { TableMediaViewer } from "./TableMediaViewer";
import { AudioDock, AudioModal } from "./AudioPlayer";
import { ManagementWorkspace } from "./ManagementWorkspace";
import { defaultGroupView, GroupPage, type GroupView } from "./GroupPage";
import { PARTY_VIEW, type GroupViewOption } from "@devils-toys/shared";

import { AppearanceModal } from "./AppearanceModal";
import { effectiveTheme, readPersonalTheme, writePersonalTheme } from "./personal-theme";
import { NpcModal } from "./NpcModal";
import { SpawnedNpcModal } from "./SpawnedNpcModal";
import { TablesModal } from "./TablesModal";
import { DiceModal as SystemDiceModal } from "./DiceModal";
import type { SaveRollSetup } from "./save-roll";
import { CalendarModal } from "./CalendarModal";
import { EncounterPage, type EncounterCombatant, type EncounterRecord } from "./EncounterPage";
import { CombatTracker } from "./CombatTracker";
import { CombatantSheet } from "./CombatantSheet";
import { useTabPicker } from "./TabPicker";
import { useHoverTip } from "./HoverTip";
import { mediaLabel } from "./media-label";
import { describeTraits } from "@devils-toys/shared";
import { rollBodyParts } from "./weapon-roll";
import { ThemePicker } from "./ThemePicker";
interface SystemStatus {
  id: SystemId;
  name: string;
  shortName: string;
  glyph: string;
  tagline: string;
  defaultTheme: ThemeId;
  rollRulesQuery: string;
  dice: DiceRules;
  groupPage: boolean;
  /** What this system's weapon words mean, for the tooltips that show them. */
  traits: ItemTrait[];
}

interface Status {
  initialized: boolean;
  systems: SystemStatus[];
  themes: ThemeId[];
}

interface RoomDetail {
  room: RoomSummary & { calendar: RoomCalendar };
  members: {
    accountId: number;
    username: string;
    displayName: string;
    activeCharacterId: number | null;
    role: "gm" | "player";
    isAdmin: boolean;
  }[];
}

interface ManagedInvitation {
  id: number;
  username: string;
  expiresAt: string;
  status: "pending" | "redeemed" | "revoked" | "expired";
}

const themeNames: Record<ThemeId, string> = {
  heroic: "Heroic Tales",
  digital: "Digital Future",
  used: "Used Universe",
  grim: "Grim Adventure",
  shinji: "Get in the VTT Shinji",
  "production-type": "Production Type"
};

function emptyRoomAudio(): RoomAudioState {
  return {
    tracks: [],
    playlists: [],
    playback: {
      trackId: null,
      playing: false,
      position: 0,
      repeat: "off",
      shuffle: false,
      playlistId: null,
      updatedAt: new Date(0).toISOString()
    }
  };
}

export function App() {
  const [status, setStatus] = useState<Status>();
  const [account, setAccount] = useState<Account>();
  const [loading, setLoading] = useState(true);

  /**
   * The status carries which game systems this server has, and installing one
   * changes that. Everything reading it — the room-creation systems, a room's
   * glyph, the rules a sheet is drawn from — is stale until this runs again.
   */
  async function refreshStatus() {
    setStatus(await api<Status>("/api/status"));
  }

  async function refresh() {
    const nextStatus = await api<Status>("/api/status");
    setStatus(nextStatus);
    if (nextStatus.initialized) {
      try {
        setAccount((await api<{ account: Account }>("/api/me")).account);
      } catch {
        setAccount(undefined);
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    refresh().catch(() => setLoading(false));
  }, []);

  if (loading || !status) return <LoadingScreen />;
  const inviteToken = window.location.pathname.match(/^\/invite\/([^/]+)$/)?.[1];
  if (inviteToken) return <InviteScreen token={decodeURIComponent(inviteToken)} onSuccess={setAccount} />;
  if (!status.initialized)
    return (
      <AuthScreen
        mode="setup"
        onSuccess={(next) => {
          setAccount(next);
          setStatus({ ...status, initialized: true });
        }}
      />
    );
  if (!account) return <AuthScreen mode="login" onSuccess={setAccount} />;
  return (
    <Workspace
      account={account}
      status={status}
      onSystemsChanged={refreshStatus}
      onLogout={async () => {
        await api("/api/logout", { method: "POST" });
        setAccount(undefined);
      }}
    />
  );
}

function LoadingScreen() {
  return (
    <main className="loading-screen">
      <div className="sigil">
        <span>DT</span>
      </div>
      <p>Setting the table</p>
    </main>
  );
}

function AuthScreen({ mode, onSuccess }: { mode: "setup" | "login"; onSuccess: (account: Account) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ account: Account }>(mode === "setup" ? "/api/setup" : "/api/login", {
        method: "POST",
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") })
      });
      onSuccess(result.account);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <div className="auth-atmosphere" aria-hidden="true">
        <span className="orbit orbit-one" />
        <span className="orbit orbit-two" />
        <div className="sun-mark">✦</div>
      </div>
      <section className="auth-panel">
        <p className="eyebrow">Local virtual tabletop</p>
        <h1>
          The Devil’s
          <br />
          Toys
        </h1>
        {/* Named no system since they left this repository: what a server runs
            is whatever its admin installed, and this page cannot know. */}
        <p className="auth-intro">One persistent table, and whichever game system it was built for.</p>
        <form onSubmit={submit}>
          <label>
            Username
            <input name="username" autoComplete="username" minLength={2} maxLength={32} required autoFocus />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete={mode === "setup" ? "new-password" : "current-password"}
              minLength={mode === "setup" ? 8 : 1}
              required
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button" disabled={busy}>
            {busy ? "One moment…" : mode === "setup" ? "Create the first GM" : "Enter the table"}
          </button>
        </form>
        <p className="auth-note">
          {mode === "setup"
            ? "This one-time setup creates the server’s initial GM and admin."
            : "Accounts are managed by this server’s GM."}
        </p>
      </section>
    </main>
  );
}

function Workspace({
  account,
  status,
  onSystemsChanged,
  onLogout
}: {
  account: Account;
  status: Status;
  onSystemsChanged: () => Promise<void>;
  onLogout: () => void;
}) {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number>();
  const [showCreate, setShowCreate] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);
  const [document, setDocument] = useState<string>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [tablesApp, setTablesApp] = useState<TablesApp>();
  const [tablesPrompt, setTablesPrompt] = useState(false);
  const [checkingTables, setCheckingTables] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);
  const [roomThemePreview, setRoomThemePreview] = useState<ThemeId>();
  // Bumped when a player picks their own theme, to re-read what is stored.
  const [themeChoiceRevision, setThemeChoiceRevision] = useState(0);

  async function loadRooms() {
    const next = (await api<{ rooms: RoomSummary[] }>("/api/rooms")).rooms;
    setRooms(next);
    setSelectedId((current) =>
      current && next.some((room) => room.id === current && !room.archived) ? current : undefined
    );
  }
  useEffect(() => {
    loadRooms();
  }, []);
  useEffect(() => {
    setRoomThemePreview(undefined);
  }, [selectedId]);

  // Only the accounts that see the link need to know whether the editor is up.
  const loadTablesApp = useCallback(async () => {
    if (account.role === "player") return;
    setCheckingTables(true);
    try {
      const next = await api<TablesApp>("/api/tables-app");
      setTablesApp(next);
      return next;
    } catch {
      setTablesApp(undefined);
    } finally {
      setCheckingTables(false);
    }
  }, [account.role]);

  useEffect(() => {
    loadTablesApp();
  }, [loadTablesApp]);

  const active = rooms.find((room) => room.id === selectedId);
  const canManage = account.role !== "player";
  const tablesUrl = tablesAppUrl(tablesApp, window.location, import.meta.env.DEV ? 10667 : undefined);
  const browserStorage = typeof localStorage === "undefined" ? undefined : localStorage;
  // Read on render rather than in an effect so opening a room never shows one
  // theme before settling on another.
  const personalTheme = useMemo(
    () => (active ? readPersonalTheme(browserStorage, active.id) : undefined),
    [active?.id, themeChoiceRevision]
  );
  const displayedTheme = roomThemePreview ?? effectiveTheme(active?.theme, personalTheme);
  return (
    <main className={`workspace theme-${displayedTheme}${railCollapsed ? " rail-collapsed" : ""}`}>
      <aside className={`rail ${menuOpen ? "rail-open" : ""}`}>
        <button
          className="brand"
          onClick={() => {
            setManagementOpen(false);
            setSelectedId(undefined);
          }}
          aria-label="The Devil's Toys home"
        >
          <span className="brand-mark">DT</span>
          <span>
            The Devil’s
            <br />
            Toys
          </span>
        </button>
        <nav className="room-list" aria-label="Rooms">
          <p className="nav-label">Your tables</p>
          {rooms
            .filter((room) => !room.archived)
            .map((room) => (
              <button
                key={room.id}
                className={selectedId === room.id ? "room-active" : ""}
                aria-label={`${room.name}, ${room.role === "gm" ? "Game master" : room.system}`}
                title={room.name}
                onClick={() => {
                  setSelectedId(room.id);
                  setMenuOpen(false);
                  setManagementOpen(false);
                }}
              >
                <span className="system-glyph">
                  {status.systems.find((system) => system.id === room.system)?.glyph ?? "?"}
                </span>
                <span>
                  {room.name}
                  <small>{room.role === "gm" ? "Game master" : room.system}</small>
                </span>
              </button>
            ))}
          {account.role !== "player" && (
            <button className="new-room" onClick={() => setShowCreate(true)} title="New room">
              <Plus size={16} /> <span>New room</span>
            </button>
          )}
          {canManage && (
            <>
              <p className="nav-label management-nav-label">Manage</p>
              {/*
                Named for what is behind it. An admin also installs game systems
                here, and "Players & characters" hid that — nobody goes looking
                for a game system under the people.
              */}
              <button
                className={`management-nav-button ${managementOpen ? "room-active" : ""}`}
                title={account.isAdmin ? "Accounts, characters, and game systems" : "Players and characters"}
                onClick={() => {
                  setManagementOpen(true);
                  setMenuOpen(false);
                }}
              >
                <UsersRound size={18} />
                <span>
                  {account.isAdmin ? "Management" : "Players & characters"}
                  {/* The rail truncates, so this stays as short as its neighbours. */}
                  <small>{account.isAdmin ? "Setup & systems" : "Company setup"}</small>
                </span>
              </button>
              {/*
                Room Config is a page of this same application at an address of
                its own, so it opens in a new tab beside the game rather than
                replacing it — and carries the open room, since configuring the
                room you are sitting in is the ordinary case.
              */}
              <a
                className="management-nav-button"
                href={roomConfigPath(active?.id)}
                target="_blank"
                rel="noreferrer"
                title="Room Config, the GM control panel"
              >
                <SlidersHorizontal size={18} />
                <span>
                  Room Config
                  <small>{active ? active.name : "Choose a room"}</small>
                </span>
              </a>
              {tablesUrl &&
                // The editor is its own application on its own port, so a link
                // leaves the game rather than opening a screen inside it. When
                // that process is not running the link would simply fail, so it
                // becomes a button that says how to start it instead.
                (tablesApp?.running ? (
                  <a
                    className="management-nav-button"
                    href={tablesUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="The Devil's Tables, the random-table editor"
                  >
                    <Library size={18} />
                    <span>
                      The Devil’s Tables
                      <small>Build random tables</small>
                    </span>
                  </a>
                ) : (
                  <button
                    className="management-nav-button tables-nav-stopped"
                    title="The Devil's Tables is not running"
                    onClick={() => {
                      setTablesPrompt(true);
                      setMenuOpen(false);
                    }}
                  >
                    <Library size={18} />
                    <span>
                      The Devil’s Tables
                      <small>Not running</small>
                    </span>
                  </button>
                ))}
            </>
          )}
        </nav>
        <div className="rail-footer">
          {/*
            The written guides, at an address of their own so they open beside
            the game rather than over it. Which one opens is read from the
            account's role, and any of them can be switched to from the page.
          */}
          <a href={helpPath()} target="_blank" rel="noreferrer" title="Help and guides">
            <LifeBuoy size={16} /> <span>Help</span>
          </a>
          <button onClick={() => setDocument("credits")} title="Credits">
            <Sparkles size={16} /> <span>Credits</span>
          </button>
          <button onClick={() => setDocument("roadmap")} title="Roadmap">
            <ScrollText size={16} /> <span>Roadmap</span>
          </button>
          <button onClick={() => setDocument("changelog")} title="Changelog">
            <FileText size={16} /> <span>Changelog</span>
          </button>
          <button onClick={onLogout} title="Sign out">
            <LogOut size={16} /> <span>Sign out</span>
          </button>
          <div className="account-chip">
            <CircleUserRound size={18} />
            <span>
              {account.username}
              <small>
                {account.role === "admin" ? "Server admin" : account.role === "gm" ? "Game master" : "Player"}
              </small>
            </span>
            <button
              className="rail-collapse"
              type="button"
              onClick={() => setRailCollapsed(true)}
              aria-label="Collapse left navigation"
              title="Collapse navigation"
            >
              <ChevronLeft />
            </button>
          </div>
        </div>
      </aside>
      {railCollapsed && (
        <button
          className="rail-expand"
          type="button"
          onClick={() => setRailCollapsed(false)}
          aria-label="Expand left navigation"
          title="Expand navigation"
        >
          <ChevronRight />
        </button>
      )}
      <button className="mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle rooms">
        <Menu />
      </button>
      {managementOpen && canManage ? (
        <ManagementWorkspace onSystemsChanged={onSystemsChanged} />
      ) : active ? (
        <TableRoom
          room={active}
          systemDefinition={status.systems.find((system) => system.id === active.system)!}
          isAdmin={account.isAdmin}
          accountId={account.id}
          hasGroupPage={status.systems.find((system) => system.id === active.system)?.groupPage ?? false}
          onRoomChange={loadRooms}
          onRoomThemePreview={setRoomThemePreview}
          onCreatePlayer={() => setShowPlayer(true)}
          personalTheme={personalTheme}
          onPersonalTheme={(theme) => {
            writePersonalTheme(browserStorage, active.id, theme);
            setThemeChoiceRevision((current) => current + 1);
          }}
        />
      ) : (
        <Lobby
          rooms={rooms}
          systems={status.systems}
          canCreate={account.role !== "player"}
          onCreate={() => setShowCreate(true)}
          onSelect={setSelectedId}
        />
      )}
      {menuOpen && <button className="rail-scrim" onClick={() => setMenuOpen(false)} aria-label="Close menu" />}
      {showCreate && account.role !== "player" && (
        <CreateRoom
          status={status}
          onClose={() => setShowCreate(false)}
          onCreated={async (room) => {
            await loadRooms();
            setManagementOpen(false);
            setSelectedId(room.id);
            setShowCreate(false);
          }}
        />
      )}
      {showPlayer && active && <CreatePlayer roomId={active.id} onClose={() => setShowPlayer(false)} />}
      {document && <DocumentModal name={document} onClose={() => setDocument(undefined)} />}
      {tablesPrompt && (
        <TablesAppDialog
          command={tablesApp?.command || "npm run dev:tables"}
          url={tablesUrl}
          checking={checkingTables}
          onRecheck={async () => {
            // Stay open while it is still down, so the command remains readable.
            if ((await loadTablesApp())?.running) setTablesPrompt(false);
          }}
          onClose={() => setTablesPrompt(false)}
        />
      )}
    </main>
  );
}

function Lobby({
  rooms,
  systems,
  canCreate,
  onCreate,
  onSelect
}: {
  rooms: RoomSummary[];
  systems: SystemStatus[];
  canCreate: boolean;
  onCreate: () => void;
  onSelect: (id: number) => void;
}) {
  const joined = rooms.filter((room) => !room.archived);
  const archived = rooms.filter((room) => room.archived);
  return (
    <section className="lobby">
      <div className="lobby-copy">
        <h2>“Those who play with the devil’s toys will be brought by degrees to wield his sword.”</h2>
        <p>— Thomas Fuller</p>
        {canCreate && (
          <button className="primary-button" onClick={onCreate}>
            <Plus size={18} /> Create a room
          </button>
        )}
        <section className="lobby-rooms" aria-label="Your tables">
          <p className="nav-label">Your tables</p>
          {joined.length > 0 ? (
            <div className="lobby-room-list">
              {joined.map((room) => (
                <button
                  className="lobby-room"
                  key={room.id}
                  onClick={() => onSelect(room.id)}
                  aria-label={`Open ${room.name}, ${room.role === "gm" ? "Game master" : "Player"}`}
                >
                  <span className="system-glyph">
                    {systems.find((system) => system.id === room.system)?.glyph ?? "?"}
                  </span>
                  <span className="lobby-room-name">
                    {room.name}
                    <small>
                      {room.role === "gm" ? "Game master" : "Player"} · {room.system}
                    </small>
                  </span>
                  <DoorOpen size={17} />
                </button>
              ))}
            </div>
          ) : (
            <p className="empty-note">
              {canCreate
                ? "You are not in any rooms yet. Create one to start a table."
                : "You are not in any rooms yet. Your GM can add you to a table."}
            </p>
          )}
        </section>
      </div>
      {archived.length > 0 && (
        <div className="archived-list">
          <p className="nav-label">Archived</p>
          {archived.map((room) => (
            <button key={room.id} onClick={() => onSelect(room.id)}>
              {room.name}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function TableRoom({
  room,
  systemDefinition,
  isAdmin,
  accountId,
  hasGroupPage,
  onRoomChange,
  onRoomThemePreview,
  onCreatePlayer,
  personalTheme,
  onPersonalTheme
}: {
  room: RoomSummary;
  systemDefinition: SystemStatus;
  isAdmin: boolean;
  accountId: number;
  hasGroupPage: boolean;
  onRoomChange: () => void;
  onRoomThemePreview: (theme: ThemeId | undefined) => void;
  onCreatePlayer: () => void;
  personalTheme: ThemeId | undefined;
  onPersonalTheme: (theme: ThemeId | undefined) => void;
}) {
  const [detail, setDetail] = useState<RoomDetail>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [presence, setPresence] = useState<PresenceMember[]>([]);
  const [panel, setPanel] = useState<"scene" | "chat" | "combat">("chat");
  const [rulesFocus, setRulesFocus] = useState("");
  const [diceOpen, setDiceOpen] = useState(false);
  const [diceInitialSave, setDiceInitialSave] = useState<SaveRollSetup>();
  const [charactersOpen, setCharactersOpen] = useState(false);
  const [characterToOpen, setCharacterToOpen] = useState<number>();
  const [charactersRevision, setCharactersRevision] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [media, setMedia] = useState<RoomMediaState>({ map: null, scene: null, references: [] });
  const [mediaOpen, setMediaOpen] = useState(false);
  const [pings, setPings] = useState<ScenePing[]>([]);
  const [audio, setAudio] = useState<RoomAudioState>(emptyRoomAudio);
  const [audioOpen, setAudioOpen] = useState(false);
  const [npcOpen, setNpcOpen] = useState(false);
  const [spawnedOpen, setSpawnedOpen] = useState(false);
  const [npcRevision, setNpcRevision] = useState(0);
  const [tablesOpen, setTablesOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [groupRevision, setGroupRevision] = useState(0);
  const [encounters, setEncounters] = useState<EncounterRecord[]>([]);
  const [encounterRevision, setEncounterRevision] = useState(0);
  const [selectedEncounterId, setSelectedEncounterId] = useState<number>();
  const [inspecting, setInspecting] = useState<EncounterCombatant>();
  const [sheetDefinitions, setSheetDefinitions] = useState<{
    character?: CharacterSheetDefinition;
    hireling?: CharacterSheetDefinition;
  }>({});
  const [mapNotationSyncRevision, setMapNotationSyncRevision] = useState(0);
  const [mapNotationChange, setMapNotationChange] = useState<MapNotationEvent>();
  const [groupView, setGroupView] = useState<GroupView>(defaultGroupView);
  // Reported by the group page once its definition has loaded; until then the
  // only tab anyone can be on is the party.
  const [groupViews, setGroupViews] = useState<GroupViewOption[]>([PARTY_VIEW]);
  const [rulesTabRevision, setRulesTabRevision] = useState(0);
  /** The tracker sits above chat; collapsing it leaves only its header. */
  const [trackerOpen, setTrackerOpen] = useState(true);

  const socketRef = useRef<WebSocket | null>(null);
  // Requests cannot be cancelled; a room switch or disabling music makes every
  // earlier result irrelevant and prevents it from restoring a cleared player.
  const audioLoadGeneration = useRef(0);
  // The dock owns the audio element; the playlist needs its live position so its
  // commands do not seek the room back to the last command's position.
  const audioPosition = useRef(0);

  /** A roll arrives both in its response and over the socket; take it once. */
  function noteMessage(message: ChatMessage) {
    setMessages((current) =>
      current.some(
        (currentMessage) =>
          currentMessage.id === message.id && Boolean(currentMessage.private) === Boolean(message.private)
      )
        ? current
        : [...current, message]
    );
  }

  function openDice(initialSave?: SaveRollSetup) {
    setDiceInitialSave(initialSave);
    setDiceOpen(true);
  }

  function closeDice() {
    setDiceOpen(false);
    setDiceInitialSave(undefined);
  }

  async function loadMedia() {
    const next = await api<RoomMediaState>(`/api/rooms/${room.id}/media`);
    setMedia(next);
  }

  async function loadAudio(generation = audioLoadGeneration.current) {
    try {
      const next = await api<RoomAudioState>(`/api/rooms/${room.id}/audio`);
      if (audioLoadGeneration.current === generation) setAudio(next);
    } catch {
      if (audioLoadGeneration.current === generation) setAudio(emptyRoomAudio());
    }
  }

  async function loadEncounters() {
    try {
      const response = await api<{ encounters: EncounterRecord[] }>(`/api/rooms/${room.id}/encounters`);
      setEncounters(response.encounters);
      setEncounterRevision((current) => current + 1);
      setSelectedEncounterId((current) =>
        current && response.encounters.some((encounter) => encounter.id === current)
          ? current
          : response.encounters[0]?.id
      );
    } catch {
      // A socket refresh can race room teardown or a failed initial load. Keep
      // the last useful roster rather than creating an unhandled rejection.
    }
  }

  /** Sheet shapes for the combat tracker's inspector, read from the room's own definitions. */
  async function loadSheetDefinitions() {
    const [characters, group] = await Promise.all([
      api<{ sheetDefinition?: CharacterSheetDefinition }>(`/api/rooms/${room.id}/characters`).catch(() => ({
        sheetDefinition: undefined
      })),
      api<{ definition?: { hirelings?: { sheet?: CharacterSheetDefinition } } }>(`/api/rooms/${room.id}/group`).catch(
        () => ({ definition: undefined })
      )
    ]);
    setSheetDefinitions({
      character: characters.sheetDefinition,
      hireling: group.definition?.hirelings?.sheet
    });
  }

  async function updatePlayback(state: Omit<AudioPlaybackState, "updatedAt">) {
    const result = await api<{ playback: AudioPlaybackState }>(`/api/rooms/${room.id}/audio/playback`, {
      method: "PATCH",
      body: JSON.stringify(state)
    });
    setAudio((current) => ({ ...current, playback: result.playback }));
  }

  async function load() {
    const [nextDetail, nextMessages] = await Promise.all([
      api<RoomDetail>(`/api/rooms/${room.id}`),
      api<{ messages: ChatMessage[] }>(`/api/rooms/${room.id}/messages`)
    ]);
    setDetail(nextDetail);
    setMessages(nextMessages.messages);
  }

  function applyCalendar(calendar: RoomCalendar) {
    setDetail((current) => (current ? { ...current, room: { ...current.room, calendar } } : current));
  }
  useEffect(() => {
    load();
    loadMedia();
    loadEncounters();
    loadSheetDefinitions();
    setGroupView(defaultGroupView());
    setGroupViews([PARTY_VIEW]);
  }, [room.id]);
  useEffect(() => {
    const generation = ++audioLoadGeneration.current;
    if (!detail || detail.room.id !== room.id) return;
    if (detail.room.musicEnabled) void loadAudio(generation);
    else {
      setAudio(emptyRoomAudio());
      setAudioOpen(false);
    }
  }, [room.id, detail?.room.musicEnabled]);
  useEffect(() => {
    let stopped = false;
    let retry: number;
    const connect = () => {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${location.host}/ws`);
      socketRef.current = socket;
      socket.onopen = () => {
        socket.send(JSON.stringify({ type: "join", roomId: room.id }));
        setMapNotationSyncRevision((current) => current + 1);
      };
      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "message" || data.type === "presence-notice") noteMessage(data.message);
        if (data.type === "messages-cleared") setMessages((current) => current.filter((message) => message.private));
        if (data.type === "presence") setPresence(data.members);
        if (data.type === "characters-updated") {
          setCharactersRevision((current) => current + 1);
          load();
          loadEncounters();
        }
        if (data.type === "media-updated") {
          loadMedia();
          loadEncounters();
        }
        if (data.type === "audio-updated") loadAudio();
        if (data.type === "audio-playback") setAudio((current) => ({ ...current, playback: data.playback }));
        if (data.type === "npcs-updated") {
          setNpcRevision((current) => current + 1);
          loadEncounters();
        }
        if (data.type === "group-updated") {
          setGroupRevision((current) => current + 1);
          loadEncounters();
        }
        // The room's own gear changed in Room Config; the sheet and group
        // pickers read it from their payloads, so both are refetched.
        if (data.type === "items-updated") {
          setCharactersRevision((current) => current + 1);
          setGroupRevision((current) => current + 1);
          load();
        }
        if (data.type === "encounters-updated") {
          loadEncounters();
        }
        if (data.type === "map-notations-updated") setMapNotationSyncRevision((current) => current + 1);
        if (data.type === "calendar-updated") applyCalendar(data.calendar as RoomCalendar);
        if (
          data.type === "map-notation-added" ||
          data.type === "map-notation-removed" ||
          data.type === "map-notations-cleared"
        )
          setMapNotationChange(data as MapNotationEvent);
        if (data.type === "scene-ping") {
          const ping = data.ping as ScenePing;
          setPings((current) => [...current, ping]);
          window.setTimeout(() => setPings((current) => current.filter((item) => item.id !== ping.id)), 2500);
        }
        if (data.type === "room-updated") {
          load();
          onRoomChange();
        }
        if (data.type === "room-access-removed") onRoomChange();
      };
      socket.onclose = () => {
        if (!stopped) retry = window.setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socketRef.current?.close();
    };
  }, [room.id]);

  // The rail's combat tab carries the encounter switcher, in the same drop-down
  // the table's own tabs use: click the active tab again to choose.
  const combatPicker = useTabPicker({
    options: encounters.map((encounter) => ({
      id: String(encounter.id),
      label: encounter.active ? encounter.name : `${encounter.name} (inactive)`
    })),
    selected: selectedEncounterId === undefined ? undefined : String(selectedEncounterId),
    label: "Encounter",
    onSelect: (id) => setSelectedEncounterId(Number(id))
  });
  useEffect(combatPicker.close, [panel]);

  const hasActiveEncounters = encounters.some((encounter) => encounter.active);
  useEffect(() => {
    if (!hasActiveEncounters) setPanel("chat");
  }, [hasActiveEncounters]);

  if (!detail) return <div className="table-loading">Opening {room.name}…</div>;
  const selectedEncounter = encounters.find((encounter) => encounter.id === selectedEncounterId);
  // The combat rail is live-only. The GM may still select and edit an inactive
  // encounter in the central tab without replacing the table's active tracker.
  const railEncounter = selectedEncounter?.active
    ? selectedEncounter
    : encounters.find((encounter) => encounter.active);
  return (
    <section className="table-shell">
      <header className="table-header">
        <div>
          <p className="eyebrow">
            {room.system} · {detail.room.role === "gm" ? "Game master" : "Player"}
          </p>
          <h1>{room.name}</h1>
        </div>
        <div className="header-actions">
          {detail.room.role === "gm" && (
            <button className="icon-button invite-player-button" onClick={onCreatePlayer} title="Create player">
              <UserPlus />
            </button>
          )}
          <button
            className="icon-button desktop-duplicate-action"
            onClick={() => {
              setCharacterToOpen(undefined);
              setCharactersOpen(true);
            }}
            title="Manage characters"
          >
            <FileText />
          </button>

          {detail.room.musicEnabled && (detail.room.role === "gm" || audio.tracks.length > 0) && (
            <button className="icon-button" onClick={() => setAudioOpen(true)} title="Shared audio">
              <Music />
            </button>
          )}
          {detail.room.role === "gm" && (
            <button className="icon-button" onClick={() => setNpcOpen(true)} title="Bestiary">
              <Skull />
            </button>
          )}
          {detail.room.role === "gm" && (
            <button className="icon-button" onClick={() => setSpawnedOpen(true)} title="Spawned NPCs">
              <UserRound />
            </button>
          )}
          {detail.room.role === "gm" && (
            <button className="icon-button" onClick={() => setTablesOpen(true)} title="Random tables">
              <Table2 />
            </button>
          )}
          {detail.room.calendarEnabled && (
            <button className="icon-button" onClick={() => setCalendarOpen(true)} title="Calendar">
              <CalendarDays />
            </button>
          )}
          {detail.room.role === "gm" ? (
            <button className="icon-button" onClick={() => setSettingsOpen(true)} title="Room settings">
              <Settings2 />
            </button>
          ) : (
            <button className="icon-button" onClick={() => setAppearanceOpen(true)} title="Your view">
              <Settings2 />
            </button>
          )}
        </div>
      </header>
      <div className="table-grid">
        <section className="scene-stage">
          <TableMediaViewer
            roomId={room.id}
            media={media}
            isGm={detail.room.role === "gm"}
            mapNotationEnabled={detail.room.mapNotationEnabled}
            mapNotationSyncRevision={mapNotationSyncRevision}
            mapNotationChange={mapNotationChange}
            requestedTab={rulesTabRevision ? { tab: "rules", revision: rulesTabRevision } : undefined}
            rulesPage={
              <Rules
                roomId={room.id}
                system={room.system}
                isGm={detail.room.role === "gm"}
                focusQuery={rulesFocus}
                onFocused={() => setRulesFocus("")}
              />
            }
            pings={pings}
            groupPage={
              hasGroupPage ? (
                <GroupPage
                  roomId={room.id}
                  system={room.system}
                  revision={groupRevision}
                  characterRevision={charactersRevision}
                  hidden={false}
                  viewerId={accountId}
                  role={detail.room.role}
                  onOpenCharacter={(characterId) => {
                    setCharacterToOpen(characterId);
                    setCharactersOpen(true);
                  }}
                  onRolled={noteMessage}
                  traits={systemDefinition.traits}
                  view={groupView}
                  onViewsChange={setGroupViews}
                  presence={presence.length ? presence : detail.members.map((member) => ({ ...member, online: false }))}
                />
              ) : undefined
            }
            groupPicker={
              hasGroupPage
                ? {
                    options: groupViews,
                    selected: groupView,
                    onSelect: (id) => setGroupView(id as GroupView)
                  }
                : undefined
            }
            encounterEnabled={encounters.length > 0 || detail.room.role === "gm"}
            encounterPage={
              <EncounterPage
                roomId={room.id}
                encounter={selectedEncounter}
                isGm={detail.room.role === "gm"}
                viewerId={accountId}
                maps={(media.library ?? [])
                  .filter((asset) => asset.kind === "map")
                  .map((asset) => ({ id: asset.id, label: mediaLabel(asset) }))}
                onChanged={loadEncounters}
              />
            }
            encounterPicker={
              encounters.length
                ? {
                    options: encounters.map((encounter) => ({ id: String(encounter.id), label: encounter.name })),
                    selected: selectedEncounter ? String(selectedEncounter.id) : "",
                    onSelect: (id) => setSelectedEncounterId(Number(id))
                  }
                : undefined
            }
            onManage={() => setMediaOpen(true)}
            onPing={(x, y) => socketRef.current?.send(JSON.stringify({ type: "scene-ping", x, y }))}
          />
        </section>
        <aside className={`context-panel panel-${panel}`}>
          {hasActiveEncounters && (
            <section
              className={`rail-encounter${trackerOpen ? "" : " rail-encounter-collapsed"}`}
              aria-label="Combat tracker"
            >
              <header className="rail-encounter-header">
                <button
                  className="rail-encounter-toggle"
                  aria-expanded={trackerOpen}
                  aria-controls="rail-encounter-body"
                  title={trackerOpen ? "Collapse the tracker" : "Expand the tracker"}
                  onClick={() => setTrackerOpen((current) => !current)}
                >
                  {trackerOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                  <Swords aria-hidden="true" />
                  <span>Combat</span>
                </button>
                {/* Switching encounters, in the same drop-down the table's tabs use. */}
                <button
                  ref={combatPicker.toggleRef}
                  className={`rail-encounter-switch${combatPicker.open ? " picker-open" : ""}`}
                  aria-haspopup="listbox"
                  aria-expanded={combatPicker.open}
                  title="Choose encounter"
                  onClick={(event) => combatPicker.toggle(event)}
                >
                  <span>{railEncounter?.name}</span>
                  <ChevronDown className={`tab-picker-chevron${encounters.length > 1 ? "" : " picker-empty"}`} />
                </button>
              </header>
              {trackerOpen && (
                <div className="rail-encounter-body" id="rail-encounter-body">
                  <CombatTracker
                    roomId={room.id}
                    encounter={railEncounter}
                    viewer={{ accountId, role: detail.room.role }}
                    onInspect={setInspecting}
                    onRolled={noteMessage}
                    traits={systemDefinition.traits}
                    onChanged={loadEncounters}
                  />
                </div>
              )}
            </section>
          )}
          {combatPicker.menu}
          <Chat
            roomId={room.id}
            messages={messages}
            canClear={detail.room.role === "gm"}
            traits={systemDefinition.traits}
            onDice={() => openDice()}
          />
        </aside>
      </div>
      <nav className="mobile-tabs">
        <button className={panel === "scene" ? "active" : ""} onClick={() => setPanel("scene")}>
          <Map />
          <span>Scene</span>
        </button>
        <button className={panel === "chat" ? "active" : ""} onClick={() => setPanel("chat")}>
          <MessageSquare />
          <span>Chat</span>
        </button>
        {hasActiveEncounters && (
          <button
            className={panel === "combat" ? "active" : ""}
            onClick={() => {
              setPanel("combat");
              setTrackerOpen(true);
            }}
          >
            <Swords />
            <span>Combat</span>
          </button>
        )}
        <button onClick={() => setCharactersOpen(true)}>
          <FileText />
          <span>Sheet</span>
        </button>
        <button onClick={() => openDice()}>
          <Dices />
          <span>Dice</span>
        </button>
        <button onClick={() => setMediaOpen(true)}>
          <Eye />
          <span>Refs</span>
        </button>
      </nav>
      {charactersOpen && (
        <CharacterModal
          roomId={room.id}
          system={room.system}
          role={detail.room.role}
          accountId={accountId}
          revision={charactersRevision}
          initialCharacterId={characterToOpen}
          onRollSave={(setup) => {
            setCharactersOpen(false);
            setCharacterToOpen(undefined);
            openDice(setup);
          }}
          onRolled={noteMessage}
          traits={systemDefinition.traits}
          onClose={() => {
            setCharactersOpen(false);
            setCharacterToOpen(undefined);
          }}
        />
      )}
      {mediaOpen &&
        (detail.room.role === "gm" ? (
          <LibraryModal roomId={room.id} media={media} onChanged={loadMedia} onClose={() => setMediaOpen(false)} />
        ) : (
          <MediaModal
            roomId={room.id}
            role={detail.room.role}
            media={media}
            onChanged={loadMedia}
            onClose={() => setMediaOpen(false)}
          />
        ))}
      {audioOpen && detail.room.musicEnabled && (
        <AudioModal
          roomId={room.id}
          audio={audio}
          isGm={detail.room.role === "gm"}
          onChanged={loadAudio}
          onPlayback={updatePlayback}
          onClose={() => setAudioOpen(false)}
          livePosition={() => audioPosition.current}
        />
      )}
      {appearanceOpen && (
        <AppearanceModal
          roomName={room.name}
          roomTheme={room.theme}
          themeNames={themeNames}
          personalTheme={personalTheme}
          onChoose={onPersonalTheme}
          onClose={() => setAppearanceOpen(false)}
        />
      )}
      {inspecting && (
        <CombatantSheet
          combatant={inspecting}
          system={room.system}
          characterSheet={sheetDefinitions.character}
          hirelingSheet={sheetDefinitions.hireling}
          npcStatblock={railEncounter?.npcStatblock}
          roomId={room.id}
          encounterId={railEncounter?.id}
          isGm={detail.room.role === "gm"}
          onChanged={loadEncounters}
          onClose={() => setInspecting(undefined)}
        />
      )}
      {npcOpen && <NpcModal roomId={room.id} revision={npcRevision} onClose={() => setNpcOpen(false)} />}
      {spawnedOpen && (
        <SpawnedNpcModal
          roomId={room.id}
          npcRevision={npcRevision}
          encounterRevision={encounterRevision}
          onClose={() => setSpawnedOpen(false)}
        />
      )}
      {tablesOpen && (
        <TablesModal
          roomId={room.id}
          isGm={detail.room.role === "gm"}
          onRolled={noteMessage}
          onClose={() => setTablesOpen(false)}
        />
      )}
      {calendarOpen && (
        <CalendarModal
          roomId={room.id}
          calendar={detail.room.calendar}
          isGm={detail.room.role === "gm"}
          onChanged={applyCalendar}
          onClose={() => setCalendarOpen(false)}
        />
      )}
      {diceOpen && (
        <SystemDiceModal
          roomId={room.id}
          diceRules={systemDefinition.dice}
          isGm={detail.room.role === "gm"}
          initialSave={diceInitialSave}
          onRolled={(message) => {
            noteMessage(message);
            closeDice();
            setPanel("chat");
          }}
          onRules={() => {
            closeDice();
            setRulesFocus(systemDefinition.rollRulesQuery);
            setRulesTabRevision((current) => current + 1);
          }}
          onClose={closeDice}
        />
      )}
      {settingsOpen && (
        <RoomSettings
          room={detail.room}
          isAdmin={isAdmin}
          onChanged={async () => {
            await load();
            await onRoomChange();
          }}
          onDeleted={onRoomChange}
          onThemePreview={onRoomThemePreview}
          onClose={() => {
            setSettingsOpen(false);
            onRoomThemePreview(undefined);
          }}
        />
      )}
      {detail.room.musicEnabled && audio.tracks.length > 0 && (
        <AudioDock
          audio={audio}
          isGm={detail.room.role === "gm"}
          onPlayback={updatePlayback}
          onOpen={() => setAudioOpen(true)}
          onPosition={(seconds) => {
            audioPosition.current = seconds;
          }}
        />
      )}
    </section>
  );
}

/** A roll's bracketed words, with what this system says each of them means. */
function RollTraits({ traits, written }: { traits: readonly ItemTrait[]; written: string }) {
  const tip = useHoverTip(
    describeTraits(written.split(", "), traits)
      .map((trait) => trait.summary)
      .join("\n")
  );
  return (
    <span className="message-traits" tabIndex={0} {...tip.props}>
      [{written}]{tip.node}
    </span>
  );
}

function Chat({
  roomId,
  messages,
  canClear,
  traits,
  onDice
}: {
  roomId: number;
  messages: ChatMessage[];
  canClear: boolean;
  /** The system's own definitions, so a roll's bracketed words can be read. */
  traits: readonly ItemTrait[];
  onDice: () => void;
}) {
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [messages.length]);
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = String(data.get("body") ?? "").trim();
    if (!body) return;
    setError("");
    try {
      await api(`/api/rooms/${roomId}/messages`, { method: "POST", body: JSON.stringify({ body }) });
      form.reset();
      const field = form.elements.namedItem("body");
      if (field instanceof HTMLTextAreaElement) field.style.height = "";
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  function handleChatKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (!shouldSubmitChatOnEnter(event.key, event.shiftKey, event.nativeEvent.isComposing)) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  async function clearChat() {
    if (!window.confirm("Permanently delete this room’s entire public chat history?")) return;
    setError("");
    try {
      await api(`/api/rooms/${roomId}/messages`, { method: "DELETE" });
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  return (
    <div className="chat">
      <div className="message-list">
        {canClear && messages.some((message) => !message.private) && (
          <button className="chat-clear" type="button" onClick={clearChat}>
            <Trash2 size={13} /> Clear chat permanently
          </button>
        )}
        {messages.length === 0 && (
          <div className="empty-copy">
            <MessageSquare />
            <h3>No words yet</h3>
            <p>
              Say something, or type <code>/r d20</code>.
            </p>
          </div>
        )}
        {messages.map((message) => (
          <article
            className={`message message-${message.kind}${message.private ? " message-private" : ""}`}
            key={`${message.private ? "private" : "public"}-${message.id}`}
          >
            <div>
              <strong>{message.displayName}</strong>
              <span className="message-meta">
                {message.private && (
                  <span
                    className={`private-marker${message.rollVisibility === "invisible" ? " invisible-marker" : ""}`}
                  >
                    {message.rollVisibility === "invisible" ? "Invisible" : "Private"}
                  </span>
                )}
                <time>
                  {new Date(`${message.createdAt}Z`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </time>
              </span>
            </div>
            <p>
              {/* A roll's own words are set apart from the weapon traits inside it,
                  and both are still authored Markdown. */}
              {message.kind === "roll" ? (
                rollBodyParts(message.body).map((part, index) =>
                  part.traits ? (
                    <RollTraits traits={traits} written={part.traits} key={index} />
                  ) : (
                    <InlineMarkdown key={index}>{part.text ?? ""}</InlineMarkdown>
                  )
                )
              ) : (
                <InlineMarkdown>{message.body}</InlineMarkdown>
              )}
            </p>
            {message.detail && (
              <small>
                <InlineMarkdown>{message.detail}</InlineMarkdown>
              </small>
            )}
          </article>
        ))}
        <div ref={end} />
      </div>
      <form className="chat-form" onSubmit={send}>
        <textarea
          name="body"
          rows={1}
          maxLength={2000}
          aria-label="Chat message"
          onKeyDown={handleChatKeyDown}
          onInput={(event) => {
            event.currentTarget.style.height = "auto";
            event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 120)}px`;
          }}
        />
        <button className="chat-send-button" aria-label="Send message" title="Send message">
          <CornerDownRight size={18} />
        </button>
        <button className="chat-dice-button" type="button" onClick={onDice} aria-label="Roll dice" title="Roll dice">
          <Dices size={18} />
        </button>
        {error && <p className="form-error">{error}</p>}
      </form>
    </div>
  );
}

function Rules({
  roomId,
  system,
  isGm,
  focusQuery,
  onFocused
}: {
  roomId: number;
  system: SystemId;
  isGm: boolean;
  focusQuery: string;
  onFocused: () => void;
}) {
  const [markdown, setMarkdown] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const rulesReading = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    api<string>(`/api/rooms/${roomId}/rules`)
      .then((value) => {
        if (active) setMarkdown(value);
      })
      .catch((cause) => {
        if (active) setLoadError((cause as Error).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [roomId]);

  useEffect(() => {
    if (!focusQuery) return;
    setQuery(focusQuery);
    onFocused();
  }, [focusQuery, onFocused]);
  const filtered = filterRules(markdown, query);
  const headings = extractRuleTocHeadings(filtered);
  const renderRulesContent = (idPrefix: string) =>
    loading ? (
      <p className="rules-status">Loading rules…</p>
    ) : loadError ? (
      <p className="form-error rules-status">Rules could not be loaded: {loadError}</p>
    ) : filtered ? (
      <RulesMarkdown markdown={filtered} idPrefix={idPrefix} roomId={roomId} isGm={isGm} />
    ) : (
      <p className="rules-status">{query ? "No matching sections." : "This rules reference is empty."}</p>
    );
  return (
    <div className="rules-panel">
      <div className="rules-search">
        <BookOpen size={17} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find in rules…"
          aria-label="Find in rules"
        />
        <a href={rulesPath(system, roomId)} target="_blank" rel="noreferrer" title="Open rules in a new tab">
          <ArrowUpRight size={17} />
          <span className="sr-only">Open rules in a new tab</span>
        </a>
      </div>
      <div className="rules-reference-layout">
        <nav className="rules-toc" aria-label="Rules headings">
          <p className="rules-toc-label">On this page</p>
          {headings.length > 0 ? (
            headings.map((heading) => (
              <button
                type="button"
                className={`rules-toc-level-${heading.level}`}
                key={`${heading.line}-${heading.id}`}
                onClick={() =>
                  rulesReading.current
                    ?.querySelector<HTMLElement>(`#center-rule-${heading.id}`)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
              >
                {heading.text}
              </button>
            ))
          ) : (
            <p className="rules-toc-empty">
              {loading ? "Loading headings…" : loadError ? "Rules unavailable." : "No headings to show."}
            </p>
          )}
        </nav>
        <div className="rules-reading markdown" ref={rulesReading}>
          {renderRulesContent("center-rule")}
        </div>
      </div>
    </div>
  );
}

function DiceModal({
  roomId,
  isGm,
  onPrivate,
  onClose,
  onRules
}: {
  roomId: number;
  isGm: boolean;
  onPrivate: (result: string) => void;
  onClose: () => void;
  onRules: () => void;
}) {
  const [count, setCount] = useState(1);
  const [sides, setSides] = useState(20);
  const [modifier, setModifier] = useState(0);
  const [privateRoll, setPrivateRoll] = useState(false);
  const [result, setResult] = useState<{ total: number; detail: string }>();
  const [error, setError] = useState("");
  async function roll() {
    setError("");
    const expression = `${count}d${sides}${modifier ? `${modifier > 0 ? "+" : ""}${modifier}` : ""}`;
    try {
      const response = await api<{ roll: { total: number; detail: string } }>(`/api/rooms/${roomId}/rolls`, {
        method: "POST",
        body: JSON.stringify({ expression, private: privateRoll })
      });
      setResult(response.roll);
      if (privateRoll) onPrivate(`${expression} → ${response.roll.total}`);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  return (
    <Modal title="Roll dice" onClose={onClose}>
      <div className="dice-builder">
        <label>
          Dice
          <input type="number" min={1} max={20} value={count} onChange={(e) => setCount(Number(e.target.value))} />
        </label>
        <div className="die-row">
          {[4, 6, 8, 10, 12, 20, 44, 66, 100].map((die) => (
            <button key={die} className={sides === die ? "selected" : ""} onClick={() => setSides(die)}>
              d{die}
            </button>
          ))}
        </div>
        <label>
          Modifier
          <input
            type="number"
            min={-100}
            max={100}
            value={modifier}
            onChange={(e) => setModifier(Number(e.target.value))}
          />
        </label>
        {isGm && (
          <label className="check-row">
            <input type="checkbox" checked={privateRoll} onChange={(e) => setPrivateRoll(e.target.checked)} /> Roll
            privately
          </label>
        )}
        {result && (
          <div className="roll-result">
            <span>{result.total}</span>
            <small>{result.detail}</small>
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
        <button className="rules-link" type="button" onClick={onRules}>
          <BookOpen /> Read rolling rules
        </button>
        <button className="primary-button" onClick={roll}>
          <Dices /> Roll {count}d{sides}
        </button>
      </div>
    </Modal>
  );
}

function CreateRoom({
  status,
  onClose,
  onCreated
}: {
  status: Status;
  onClose: () => void;
  onCreated: (room: RoomSummary) => void;
}) {
  // Whatever the server offered first, rather than a system this build happens
  // to ship — an installation may not have that one, or may not offer it.
  const [system, setSystem] = useState<SystemId>(status.systems[0]?.id ?? "");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!status.systems.length) return;
    const data = new FormData(event.currentTarget);
    try {
      const result = await api<{ room: RoomSummary }>("/api/rooms", {
        method: "POST",
        body: JSON.stringify({ name: data.get("name"), system })
      });
      onCreated(result.room);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  return (
    <Modal title="Create a room" onClose={onClose}>
      <form className="stack-form" onSubmit={submit}>
        <label>
          Room name
          <input name="name" required minLength={2} maxLength={80} autoFocus placeholder="The Moss-Covered Door" />
        </label>
        <fieldset>
          <legend>Game system</legend>
          {status.systems.length ? (
            status.systems.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`system-choice ${system === item.id ? "selected" : ""}`}
                onClick={() => setSystem(item.id)}
              >
                <span>{item.glyph}</span>
                <div>
                  <strong>{item.name}</strong>
                  <small>{item.tagline}</small>
                </div>
              </button>
            ))
          ) : (
            <p className="form-error">
              This server has no game system yet. The Devil's Toys is the tabletop; a game system is installed into it.
              An administrator can add one under Management → Systems, and a retired system is restored from the same
              place.
            </p>
          )}
        </fieldset>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" disabled={!status.systems.length}>
          Create room
        </button>
      </form>
    </Modal>
  );
}

function CreatePlayer({ roomId, onClose }: { roomId: number; onClose: () => void }) {
  const [invitations, setInvitations] = useState<ManagedInvitation[]>([]);
  const [createdLink, setCreatedLink] = useState("");
  const [error, setError] = useState("");

  async function loadInvitations() {
    const result = await api<{ invitations: ManagedInvitation[] }>(`/api/rooms/${roomId}/invitations`);
    setInvitations(result.invitations);
  }

  useEffect(() => {
    loadInvitations().catch((cause: Error) => setError(cause.message));
  }, [roomId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError("");
    try {
      const result = await api<{ invitation: ManagedInvitation & { token: string } }>(
        `/api/rooms/${roomId}/invitations`,
        {
          method: "POST",
          body: JSON.stringify({ username: data.get("username") })
        }
      );
      setCreatedLink(`${window.location.origin}/invite/${result.invitation.token}`);
      form.reset();
      await loadInvitations();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function revoke(invitationId: number) {
    setError("");
    try {
      await api(`/api/rooms/${roomId}/invitations/${invitationId}`, { method: "DELETE" });
      await loadInvitations();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <Modal title="Invite a player" onClose={onClose}>
      <form className="stack-form" onSubmit={submit}>
        <p className="modal-intro">
          Create a private, single-use link. The player chooses their own password when they join this room.
        </p>
        <label>
          Username
          <input name="username" required minLength={2} maxLength={32} autoFocus />
        </label>
        {error && <p className="form-error">{error}</p>}
        {createdLink && (
          <div className="invite-link">
            <span>Share this link once</span>
            <input value={createdLink} readOnly aria-label="Invitation link" />
            <button type="button" onClick={() => navigator.clipboard?.writeText(createdLink)}>
              Copy link
            </button>
          </div>
        )}
        <button className="primary-button">
          <UserPlus /> Create invitation
        </button>
        {invitations.length > 0 && (
          <section className="invite-list" aria-label="Room invitations">
            <p className="eyebrow">Invitation history</p>
            {invitations.map((invitation) => (
              <div className="invite-row" key={invitation.id}>
                <div>
                  <strong>{invitation.username}</strong>
                  <small>{invitation.status}</small>
                </div>
                {invitation.status === "pending" && (
                  <button type="button" onClick={() => revoke(invitation.id)}>
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </section>
        )}
      </form>
    </Modal>
  );
}

function RoomSettings({
  room,
  isAdmin,
  onChanged,
  onDeleted,
  onThemePreview,
  onClose
}: {
  room: RoomSummary;
  isAdmin: boolean;
  onChanged: () => void | Promise<void>;
  onDeleted: () => void | Promise<void>;
  onThemePreview: (theme: ThemeId) => void;
  onClose: () => void;
}) {
  const [theme, setTheme] = useState(room.theme);
  const [calendarEnabled, setCalendarEnabled] = useState(room.calendarEnabled);
  const [mapNotationEnabled, setMapNotationEnabled] = useState(room.mapNotationEnabled);
  const [musicEnabled, setMusicEnabled] = useState(room.musicEnabled);
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState("");

  async function save() {
    setError("");
    try {
      await api(`/api/rooms/${room.id}`, {
        method: "PATCH",
        body: JSON.stringify({ theme, calendarEnabled, mapNotationEnabled, musicEnabled })
      });
      await onChanged();
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function setArchived(archived: boolean) {
    setError("");
    try {
      await api(`/api/rooms/${room.id}`, { method: "PATCH", body: JSON.stringify({ archived }) });
      await onChanged();
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function deleteRoom() {
    if (confirmName !== room.name) return;
    setError("");
    try {
      await api(`/api/rooms/${room.id}`, { method: "DELETE" });
      await onDeleted();
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <Modal title="Room settings" onClose={onClose}>
      <div className="settings-list">
        <div className="theme-field">
          <span>Theme</span>
          <ThemePicker
            value={theme}
            names={themeNames}
            onChange={(nextTheme) => {
              setTheme(nextTheme);
              onThemePreview(nextTheme);
            }}
          />
        </div>
        <p className="modal-intro">The game system is fixed as {room.system}. Themes can change at any time.</p>
        <label className={`toggle-row ${calendarEnabled ? "enabled" : ""}`}>
          <span className="toggle-copy">
            <strong>Calendar</strong>
            <small>Show the shared in-game calendar to everyone in this room.</small>
          </span>
          <span className="toggle-control">
            <input
              type="checkbox"
              checked={calendarEnabled}
              onChange={(event) => setCalendarEnabled(event.target.checked)}
            />
            <span aria-hidden="true" />
          </span>
        </label>
        <label className={`toggle-row ${mapNotationEnabled ? "enabled" : ""}`}>
          <span className="toggle-copy">
            <strong>Map notation</strong>
            <small>Let everyone draw, label, and mark up maps together.</small>
          </span>
          <span className="toggle-control">
            <input
              type="checkbox"
              checked={mapNotationEnabled}
              onChange={(event) => setMapNotationEnabled(event.target.checked)}
            />
            <span aria-hidden="true" />
          </span>
        </label>
        <label className={`toggle-row ${musicEnabled ? "enabled" : ""}`}>
          <span className="toggle-copy">
            <strong>Music playback</strong>
            <small>Show shared music controls and playback to everyone in this room.</small>
          </span>
          <span className="toggle-control">
            <input type="checkbox" checked={musicEnabled} onChange={(event) => setMusicEnabled(event.target.checked)} />
            <span aria-hidden="true" />
          </span>
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" onClick={save}>
          Save changes
        </button>
        {room.archived ? (
          <button className="secondary-button" onClick={() => setArchived(false)}>
            <RotateCcw size={17} /> Restore room
          </button>
        ) : (
          <button className="danger-button" onClick={() => setArchived(true)}>
            <Archive size={17} /> Archive room
          </button>
        )}
        {isAdmin && (
          <details className="danger-zone">
            <summary>Permanent deletion</summary>
            <p>Delete this room and all of its messages, memberships, and stored room data. This cannot be undone.</p>
            <label>
              Type {room.name} to confirm
              <input value={confirmName} onChange={(event) => setConfirmName(event.target.value)} autoComplete="off" />
            </label>
            <button className="danger-button" onClick={deleteRoom} disabled={confirmName !== room.name}>
              <Trash2 size={17} /> Delete room permanently
            </button>
          </details>
        )}
      </div>
    </Modal>
  );
}

function DocumentModal({ name, onClose }: { name: string; onClose: () => void }) {
  const [content, setContent] = useState("");
  useEffect(() => {
    api<string>(`/api/project/${name}`).then(setContent);
  }, [name]);
  return (
    <Modal title={name[0].toUpperCase() + name.slice(1)} onClose={onClose} wide>
      <div className="markdown project-document">
        <RulesMarkdown markdown={content} idPrefix={`project-${name}`} />
      </div>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
  wide = false,
  className = ""
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    addEventListener("keydown", close);
    return () => removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={["modal", wide ? "modal-wide" : "", className].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <p className="eyebrow">The Devil’s Toys</p>
          <h2>{title}</h2>
          <button onClick={onClose} aria-label="Close">
            <X />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
