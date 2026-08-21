import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Boxes,
  Check,
  ContactRound,
  DoorOpen,
  KeyRound,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  UserPlus,
  UsersRound
} from "lucide-react";
import type { AccountRole, SystemId } from "@devils-toys/shared";
import { api } from "./api";
import { accountRoleLabels, requiresOwnedRoomDowngradeWarning } from "./account-roles";
import {
  playsInRoom,
  roomCastSummary,
  roomDeletionArmed,
  seatableGms,
  type ManagedRoomRecord,
  type RoomGmCandidate
} from "./room-management";
import { SystemsManagement } from "./SystemsManagement";
import "./management.css";

interface ManagedRoom {
  id: number;
  name: string;
  system: SystemId;
}

interface ManagedPlayer {
  id: number;
  username: string;
  role: AccountRole;
  createdAt: string;
  rooms: ManagedRoom[];
  ownedRooms: ManagedRoom[];
}

interface ManagedCharacter {
  id: number;
  system: SystemId;
  name: string;
  ownerAccountId: number | null;
  ownerUsername: string | null;
  roomId: number | null;
  roomName: string | null;
  warnings: string[];
  updatedAt: string;
}

interface ManagementData {
  viewerRole: AccountRole;
  viewerAccountId: number;
  systems: { id: SystemId; name: string; glyph: string }[];
  rooms: ManagedRoomRecord[];
  /** Empty for a GM: only an admin seats somebody else at a table. */
  gmCandidates: RoomGmCandidate[];
  players: ManagedPlayer[];
  characters: ManagedCharacter[];
}

type Section = "rooms" | "players" | "characters" | "systems";

export function ManagementWorkspace({
  onSystemsChanged,
  onRoomsChanged
}: {
  onSystemsChanged?: () => Promise<void>;
  /** The rail keeps its own list of rooms, and this panel makes and unmakes them. */
  onRoomsChanged?: () => Promise<void>;
}) {
  const [data, setData] = useState<ManagementData>();
  const [section, setSection] = useState<Section>("rooms");
  const [selectedRoomId, setSelectedRoomId] = useState<number>();
  const [selectedPlayerId, setSelectedPlayerId] = useState<number>();
  const [selectedCharacterId, setSelectedCharacterId] = useState<number>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const next = await api<ManagementData>("/api/management");
    setData(next);
    setSelectedRoomId((current) =>
      current && next.rooms.some((room) => room.id === current) ? current : next.rooms[0]?.id
    );
    setSelectedPlayerId((current) =>
      current && next.players.some((player) => player.id === current) ? current : next.players[0]?.id
    );
    setSelectedCharacterId((current) =>
      current && next.characters.some((character) => character.id === current) ? current : next.characters[0]?.id
    );
  }

  useEffect(() => {
    load().catch((cause) => setError((cause as Error).message));
  }, []);

  async function act(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await load();
      setNotice(success);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const selectedRoom = data?.rooms.find((room) => room.id === selectedRoomId);
  const selectedPlayer = data?.players.find((player) => player.id === selectedPlayerId);
  const selectedCharacter = data?.characters.find((character) => character.id === selectedCharacterId);

  return (
    <section className="management-workspace">
      <header className="management-header">
        <div>
          <p className="eyebrow">Company management</p>
          <h1>Prepare the company.</h1>
          <p>
            Open a table, create the accounts and characters it will need, then place them when the campaign is ready.
          </p>
        </div>
        <div className="management-stat">
          <ShieldCheck size={18} />
          <span>
            {data?.rooms.length ?? "—"}
            <small>manageable rooms</small>
          </span>
        </div>
      </header>

      <nav className="management-tabs" aria-label="Management sections">
        {/* The room comes first because everything else in this panel is placed
            into one: an account is given room access, a character is pooled in a
            room, and a system is what a room is played on. */}
        <button className={section === "rooms" ? "active" : ""} onClick={() => setSection("rooms")}>
          <DoorOpen size={17} /> Rooms <span>{data?.rooms.length ?? 0}</span>
        </button>
        <button className={section === "players" ? "active" : ""} onClick={() => setSection("players")}>
          <UsersRound size={17} /> {data?.viewerRole === "admin" ? "Accounts" : "Players"}{" "}
          <span>{data?.players.length ?? 0}</span>
        </button>
        <button className={section === "characters" ? "active" : ""} onClick={() => setSection("characters")}>
          <ContactRound size={17} /> Characters <span>{data?.characters.length ?? 0}</span>
        </button>
        {/* A system is server-wide: a GM configures a room, an admin decides
            what the server can run at all. */}
        {data?.viewerRole === "admin" && (
          <button className={section === "systems" ? "active" : ""} onClick={() => setSection("systems")}>
            <Boxes size={17} /> Systems <span>{data?.systems.length ?? 0}</span>
          </button>
        )}
      </nav>

      {(error || notice) && (
        <p className={`management-message ${error ? "error" : "success"}`} role={error ? "alert" : "status"}>
          {error || notice}
        </p>
      )}

      {!data ? (
        <div className="management-loading">Opening the company ledger…</div>
      ) : section === "systems" ? (
        <SystemsManagement onSystemsChanged={onSystemsChanged} />
      ) : section === "rooms" ? (
        <RoomManagement
          data={data}
          selected={selectedRoom}
          selectedId={selectedRoomId}
          onSelect={setSelectedRoomId}
          busy={busy}
          act={act}
          onRoomsChanged={onRoomsChanged}
        />
      ) : section === "players" ? (
        <PlayerManagement
          data={data}
          selected={selectedPlayer}
          selectedId={selectedPlayerId}
          onSelect={setSelectedPlayerId}
          busy={busy}
          act={act}
        />
      ) : (
        <CharacterManagement
          data={data}
          selected={selectedCharacter}
          selectedId={selectedCharacterId}
          onSelect={setSelectedCharacterId}
          busy={busy}
          act={act}
          onCreated={setSelectedCharacterId}
        />
      )}
    </section>
  );
}

function RoomManagement({
  data,
  selected,
  selectedId,
  onSelect,
  busy,
  act,
  onRoomsChanged
}: {
  data: ManagementData;
  selected: ManagedRoomRecord | undefined;
  selectedId: number | undefined;
  onSelect: (id: number) => void;
  busy: boolean;
  act: (action: () => Promise<void>, success: string) => Promise<void>;
  onRoomsChanged?: () => Promise<void>;
}) {
  const [gmAccountId, setGmAccountId] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const isAdmin = data.viewerRole === "admin";

  useEffect(() => {
    setGmAccountId(selected?.gm?.id.toString() ?? "");
    setConfirmName("");
  }, [selected?.id, selected?.gm?.id]);

  const gmOptions = useMemo(() => seatableGms(data.gmCandidates, selected), [data.gmCandidates, selected]);
  // The GM is listed as the room's GM rather than as one of its players, and
  // holds a membership already: offering them the player toggle would only ever
  // produce a refusal.
  const assignablePlayers = data.players.filter((player) => player.id !== selected?.gm?.id);

  async function createRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data.systems.length) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const gm = values.get("gm");
    await act(async () => {
      const result = await api<{ room: ManagedRoomRecord }>("/api/management/rooms", {
        method: "POST",
        body: JSON.stringify({
          name: values.get("name"),
          system: values.get("system"),
          ...(gm ? { gmAccountId: Number(gm) } : {})
        })
      });
      onSelect(result.room.id);
      form.reset();
      await onRoomsChanged?.();
    }, "Room created. Assign its players when the table is ready.");
  }

  async function assignGm() {
    if (!selected || !gmAccountId || Number(gmAccountId) === selected.gm?.id) return;
    const incoming = gmOptions.find((candidate) => candidate.id === Number(gmAccountId));
    if (
      selected.gm &&
      !window.confirm(
        `${incoming?.username ?? "That account"} will run ${selected.name}. ` +
          `${selected.gm.username} stays at the table as a player. Continue?`
      )
    )
      return;
    await act(
      async () => {
        await api(`/api/management/rooms/${selected.id}`, {
          method: "PATCH",
          body: JSON.stringify({ gmAccountId: Number(gmAccountId) })
        });
        await onRoomsChanged?.();
      },
      `${incoming?.username ?? "That account"} now runs ${selected.name}.`
    );
  }

  async function togglePlayer(player: ManagedPlayer, assigned: boolean) {
    if (!selected) return;
    await act(
      () =>
        api(`/api/management/players/${player.id}/rooms/${selected.id}`, {
          method: assigned ? "DELETE" : "PUT"
        }),
      assigned ? `${player.username} removed from ${selected.name}.` : `${player.username} joined ${selected.name}.`
    );
  }

  return (
    <>
      <form className={`management-create room-create${isAdmin ? " with-gm" : ""}`} onSubmit={createRoom}>
        <div className="create-heading">
          <DoorOpen size={19} />
          <span>
            Open a room
            <small>{isAdmin ? "Choose the system, and who will run it." : "You will be its game master."}</small>
          </span>
        </div>
        <label>
          Room name
          <input name="name" minLength={2} maxLength={80} required placeholder="The Moss-Covered Door" />
        </label>
        <label>
          System
          <select name="system" defaultValue={data.systems[0]?.id} disabled={!data.systems.length}>
            {data.systems.map((system) => (
              <option value={system.id} key={system.id}>
                {system.name}
              </option>
            ))}
          </select>
        </label>
        {isAdmin && (
          <label>
            Game master
            <select name="gm" defaultValue={data.viewerAccountId}>
              {data.gmCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.username}
                  {candidate.id === data.viewerAccountId ? " (you)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        {!data.systems.length && (
          <p className="form-error">
            No game systems are available. An administrator must install or restore one before a room can be opened.
          </p>
        )}
        <button className="primary-button compact" disabled={busy || !data.systems.length}>
          <Plus size={16} /> Create room
        </button>
      </form>

      <div className="management-ledger">
        <div className="ledger-index">
          <div className="ledger-label">
            Room register <span>{data.rooms.length}</span>
          </div>
          {data.rooms.length === 0 ? (
            <p className="ledger-empty">No rooms yet. Open the first one above.</p>
          ) : (
            data.rooms.map((room) => (
              <button
                key={room.id}
                className={selectedId === room.id ? "selected" : ""}
                onClick={() => onSelect(room.id)}
              >
                <span className="system-glyph">
                  {data.systems.find((system) => system.id === room.system)?.glyph ?? "?"}
                </span>
                <span className="ledger-name">
                  {room.name}
                  <small>{roomCastSummary(room)}</small>
                </span>
                {room.archived && <span className="registry-status open">Archived</span>}
              </button>
            ))
          )}
        </div>

        <div className="ledger-inspector">
          {selected ? (
            <>
              <div className="inspector-heading">
                <div>
                  <p className="eyebrow">
                    {selected.system} room{selected.archived ? " · archived" : ""}
                  </p>
                  <h2>{selected.name}</h2>
                </div>
                <span className="record-number">R-{String(selected.id).padStart(3, "0")}</span>
              </div>
              <section className="inspector-section role-setting">
                <h3>Game master</h3>
                {isAdmin ? (
                  <>
                    <p>Whoever sits here runs the room. The GM they replace stays at the table as a player.</p>
                    <div>
                      <select
                        value={gmAccountId}
                        onChange={(event) => setGmAccountId(event.target.value)}
                        aria-label="Room game master"
                      >
                        {!selected.gm && <option value="">Nobody</option>}
                        {gmOptions.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.username}
                            {candidate.id === data.viewerAccountId ? " (you)" : ""}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy || !gmAccountId || Number(gmAccountId) === selected.gm?.id}
                        onClick={assignGm}
                      >
                        <Save size={15} /> Assign GM
                      </button>
                    </div>
                  </>
                ) : (
                  <p>
                    {selected.gm ? `${selected.gm.username} runs this room.` : "Nobody runs this room."} Only an admin
                    can hand it to a different GM.
                  </p>
                )}
              </section>
              <section className="inspector-section">
                <h3>Players at this table</h3>
                <p>Assign any account you manage. A player reaches the room as soon as they are added.</p>
                <div className="assignment-list">
                  {assignablePlayers.length === 0 ? (
                    <p className="ledger-empty">
                      No accounts to assign yet. Create one under {isAdmin ? "Accounts" : "Players"}.
                    </p>
                  ) : (
                    assignablePlayers.map((player) => {
                      const assigned = playsInRoom(selected, player.id);
                      return (
                        <button
                          key={player.id}
                          className={assigned ? "assigned" : ""}
                          disabled={busy}
                          onClick={() => togglePlayer(player, assigned)}
                        >
                          <span className="ledger-monogram">{player.username.slice(0, 2).toUpperCase()}</span>
                          <span>
                            {player.username}
                            <small>{accountRoleLabels[player.role]}</small>
                          </span>
                          <span className="assignment-state">{assigned ? <Check size={15} /> : "Add"}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </section>
              {isAdmin && (
                <details className="danger-zone">
                  <summary>Permanent deletion</summary>
                  <p>
                    Delete this room and all of its messages, memberships, and stored room data. This cannot be undone —
                    archive it from the room's own settings if you may want it back.
                  </p>
                  <label>
                    Type {selected.name} to confirm
                    <input
                      value={confirmName}
                      onChange={(event) => setConfirmName(event.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <button
                    type="button"
                    className="danger-button"
                    disabled={busy || !roomDeletionArmed(confirmName, selected.name)}
                    onClick={() =>
                      act(async () => {
                        await api(`/api/management/rooms/${selected.id}`, { method: "DELETE" });
                        await onRoomsChanged?.();
                      }, `${selected.name} deleted.`)
                    }
                  >
                    <Trash2 size={15} /> Delete room permanently
                  </button>
                </details>
              )}
            </>
          ) : (
            <p className="ledger-empty">Select a room to seat its GM and assign its players.</p>
          )}
        </div>
      </div>
    </>
  );
}

function PlayerManagement({
  data,
  selected,
  selectedId,
  onSelect,
  busy,
  act
}: {
  data: ManagementData;
  selected: ManagedPlayer | undefined;
  selectedId: number | undefined;
  onSelect: (id: number) => void;
  busy: boolean;
  act: (action: () => Promise<void>, success: string) => Promise<void>;
}) {
  const [resetPassword, setResetPassword] = useState("");
  const [accountRole, setAccountRole] = useState<AccountRole>(selected?.role ?? "player");

  useEffect(() => setAccountRole(selected?.role ?? "player"), [selected?.id, selected?.role]);

  async function createPlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    await act(async () => {
      const result = await api<{ player: ManagedPlayer }>("/api/management/players", {
        method: "POST",
        body: JSON.stringify({
          username: values.get("username"),
          password: values.get("password"),
          role: data.viewerRole === "admin" ? values.get("role") : "player"
        })
      });
      onSelect(result.player.id);
      form.reset();
    }, "Account created. They can sign in with the initial password.");
  }

  async function toggleRoom(room: ManagedRoom, assigned: boolean) {
    if (!selected) return;
    await act(
      () =>
        api(`/api/management/players/${selected.id}/rooms/${room.id}`, {
          method: assigned ? "DELETE" : "PUT"
        }),
      assigned ? `${selected.username} removed from ${room.name}.` : `${selected.username} assigned to ${room.name}.`
    );
  }

  async function updateRole() {
    if (!selected || accountRole === selected.role) return;
    const needsConfirmation = requiresOwnedRoomDowngradeWarning(selected.role, accountRole, selected.ownedRooms.length);
    if (
      needsConfirmation &&
      !window.confirm(
        `${selected.username} manages ${selected.ownedRooms.map((room) => room.name).join(", ")}. ` +
          "Downgrading them to Player will transfer those rooms to your admin account. Continue?"
      )
    )
      return;
    await act(
      () =>
        api(`/api/management/players/${selected.id}/role`, {
          method: "PATCH",
          body: JSON.stringify({ role: accountRole, confirmRoomTransfer: needsConfirmation })
        }),
      `${selected.username} is now ${accountRoleLabels[accountRole]}.`
    );
  }

  return (
    <>
      <form className="management-create account-create" onSubmit={createPlayer}>
        <div className="create-heading">
          <UserPlus size={19} />
          <span>
            {data.viewerRole === "admin" ? "Add an account" : "Add a player"}
            <small>Create their sign-in now; room access can wait.</small>
          </span>
        </div>
        <label>
          Username
          <input name="username" minLength={2} maxLength={32} required placeholder="marrow-keeper" />
        </label>
        <label>
          Initial password
          <input name="password" type="password" minLength={8} maxLength={128} required placeholder="8+ characters" />
        </label>
        <label>
          Role
          <select name="role" defaultValue="player">
            <option value="player">Player</option>
            {data.viewerRole === "admin" && <option value="gm">Game master</option>}
            {data.viewerRole === "admin" && <option value="admin">Server admin</option>}
          </select>
        </label>
        <button className="primary-button compact" disabled={busy}>
          <Plus size={16} /> Create account
        </button>
      </form>

      <div className="management-ledger">
        <div className="ledger-index">
          <div className="ledger-label">
            {data.viewerRole === "admin" ? "Account roster" : "Player roster"} <span>{data.players.length}</span>
          </div>
          {data.players.length === 0 ? (
            <p className="ledger-empty">No manageable accounts yet. Create the first account above.</p>
          ) : (
            data.players.map((player) => (
              <button
                key={player.id}
                className={selectedId === player.id ? "selected" : ""}
                onClick={() => onSelect(player.id)}
              >
                <span className="ledger-monogram">{player.username.slice(0, 2).toUpperCase()}</span>
                <span className="ledger-name">
                  {player.username}
                  <small>{accountRoleLabels[player.role]}</small>
                </span>
                <span className="ledger-count">{player.rooms.length}</span>
              </button>
            ))
          )}
        </div>

        <div className="ledger-inspector">
          {selected ? (
            <>
              <div className="inspector-heading">
                <div>
                  <p className="eyebrow">Account record</p>
                  <h2>{selected.username}</h2>
                </div>
                <span className="record-number">A-{String(selected.id).padStart(3, "0")}</span>
              </div>
              {data.viewerRole === "admin" && (
                <section className="inspector-section role-setting">
                  <h3>Account role</h3>
                  <p>Controls who can create rooms and manage other accounts.</p>
                  <div>
                    <select
                      value={accountRole}
                      onChange={(event) => setAccountRole(event.target.value as AccountRole)}
                      aria-label="Account role"
                    >
                      <option value="player">Player</option>
                      <option value="gm">Game master</option>
                      <option value="admin">Server admin</option>
                    </select>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy || accountRole === selected.role}
                      onClick={updateRole}
                    >
                      <Save size={15} /> Save role
                    </button>
                  </div>
                  {requiresOwnedRoomDowngradeWarning(selected.role, accountRole, selected.ownedRooms.length) && (
                    <p className="role-warning">
                      Downgrading this account transfers{" "}
                      {selected.ownedRooms.length === 1 ? "their room" : "their rooms"} to your admin account.
                    </p>
                  )}
                </section>
              )}
              <section className="inspector-section">
                <h3>Room access</h3>
                <p>Assign this account as a player at any table you manage.</p>
                <div className="assignment-list">
                  {data.rooms.map((room) => {
                    const assigned = selected.rooms.some((item) => item.id === room.id);
                    return (
                      <button
                        key={room.id}
                        className={assigned ? "assigned" : ""}
                        disabled={busy}
                        onClick={() => toggleRoom(room, assigned)}
                      >
                        <span className="system-glyph">
                          {data.systems.find((system) => system.id === room.system)?.glyph ?? "?"}
                        </span>
                        <span>
                          {room.name}
                          <small>{room.system}</small>
                        </span>
                        <span className="assignment-state">{assigned ? <Check size={15} /> : "Add"}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
              <form
                className="inspector-section password-reset"
                onSubmit={(event) => {
                  event.preventDefault();
                  act(
                    () =>
                      api(`/api/management/players/${selected.id}/password`, {
                        method: "PATCH",
                        body: JSON.stringify({ password: resetPassword })
                      }),
                    `${selected.username}'s password was reset.`
                  ).then(() => setResetPassword(""));
                }}
              >
                <h3>Reset password</h3>
                <p>This signs the player out everywhere and replaces their current password.</p>
                <div>
                  <input
                    type="password"
                    minLength={8}
                    maxLength={128}
                    required
                    value={resetPassword}
                    onChange={(event) => setResetPassword(event.target.value)}
                    placeholder="New password"
                  />
                  <button className="secondary-button" disabled={busy}>
                    <KeyRound size={15} /> Reset
                  </button>
                </div>
              </form>
            </>
          ) : (
            <p className="ledger-empty">Select an account to manage its role and room access.</p>
          )}
        </div>
      </div>
    </>
  );
}

function CharacterManagement({
  data,
  selected,
  selectedId,
  onSelect,
  busy,
  act,
  onCreated
}: {
  data: ManagementData;
  selected: ManagedCharacter | undefined;
  selectedId: number | undefined;
  onSelect: (id: number) => void;
  busy: boolean;
  act: (action: () => Promise<void>, success: string) => Promise<void>;
  onCreated: (id: number) => void;
}) {
  const [name, setName] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [roomId, setRoomId] = useState("");

  useEffect(() => {
    setName(selected?.name ?? "");
    setOwnerId(selected?.ownerAccountId?.toString() ?? "");
    setRoomId(selected?.roomId?.toString() ?? "");
  }, [selected?.id, selected?.name, selected?.ownerAccountId, selected?.roomId]);

  const compatibleRooms = useMemo(
    () => data.rooms.filter((room) => !selected || room.system === selected.system),
    [data.rooms, selected]
  );

  async function createCharacter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data.systems.length) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    await act(async () => {
      const result = await api<{ character: ManagedCharacter }>("/api/management/characters", {
        method: "POST",
        body: JSON.stringify({
          name: values.get("name"),
          system: values.get("system"),
          ownerAccountId: null,
          roomId: null
        })
      });
      onCreated(result.character.id);
      form.reset();
    }, "Character created and left unassigned.");
  }

  async function saveCharacter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    await act(
      () =>
        api(`/api/management/characters/${selected.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name,
            ownerAccountId: ownerId ? Number(ownerId) : null,
            roomId: roomId ? Number(roomId) : null
          })
        }),
      `${name} updated.`
    );
  }

  return (
    <>
      <form className="management-create" onSubmit={createCharacter}>
        <div className="create-heading">
          <ContactRound size={19} />
          <span>
            Add a character
            <small>Start a record without choosing its player or room.</small>
          </span>
        </div>
        <label>
          Character name
          <input name="name" minLength={1} maxLength={80} required placeholder="Bracken Vale" />
        </label>
        <label>
          System
          <select name="system" defaultValue={data.systems[0]?.id} disabled={!data.systems.length}>
            {data.systems.map((system) => (
              <option value={system.id} key={system.id}>
                {system.name}
              </option>
            ))}
          </select>
        </label>
        {!data.systems.length && (
          <p className="form-error">
            No game systems are available. An administrator must install or restore one before a character can be
            created.
          </p>
        )}
        <button className="primary-button compact" disabled={busy || !data.systems.length}>
          <Plus size={16} /> Create character
        </button>
      </form>

      <div className="management-ledger">
        <div className="ledger-index">
          <div className="ledger-label">
            Character registry <span>{data.characters.length}</span>
          </div>
          {data.characters.length === 0 ? (
            <p className="ledger-empty">No character records yet.</p>
          ) : (
            data.characters.map((character) => (
              <button
                key={character.id}
                className={selectedId === character.id ? "selected" : ""}
                onClick={() => onSelect(character.id)}
              >
                <span className="system-glyph">
                  {data.systems.find((system) => system.id === character.system)?.glyph ?? "?"}
                </span>
                <span className="ledger-name">
                  {character.name}
                  <small>
                    {character.ownerUsername ?? "No player"} · {character.roomName ?? "No room"}
                  </small>
                </span>
                <span className={`registry-status ${character.ownerAccountId || character.roomId ? "" : "open"}`}>
                  {character.ownerAccountId && character.roomId ? "Placed" : "Open"}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="ledger-inspector">
          {selected ? (
            <form onSubmit={saveCharacter}>
              <div className="inspector-heading">
                <div>
                  <p className="eyebrow">{selected.system} character</p>
                  <h2>{selected.name}</h2>
                </div>
                <span className="record-number">C-{String(selected.id).padStart(3, "0")}</span>
              </div>
              <section className="inspector-section character-fields">
                <label>
                  Name
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    minLength={1}
                    maxLength={80}
                    required
                  />
                </label>
                <label>
                  Player
                  <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
                    <option value="">Unassigned</option>
                    {data.players.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.username}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Room
                  <select value={roomId} onChange={(event) => setRoomId(event.target.value)}>
                    <option value="">Unassigned</option>
                    {compatibleRooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name}
                      </option>
                    ))}
                  </select>
                </label>
                {ownerId &&
                  roomId &&
                  !data.players
                    .find((player) => player.id === Number(ownerId))
                    ?.rooms.some((room) => room.id === Number(roomId)) && (
                    <p className="assignment-warning">
                      Assign this player to the room in Players before saving both placements.
                    </p>
                  )}
              </section>
              {selected.warnings.length > 0 && (
                <section className="inspector-section">
                  <h3>Sheet notes</h3>
                  <ul className="character-warnings">
                    {selected.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </section>
              )}
              <p className="sheet-note">Full sheet details are edited from Characters inside a compatible room.</p>
              <div className="inspector-actions">
                <button className="primary-button compact" disabled={busy}>
                  <Save size={16} /> Save record
                </button>
                <button
                  type="button"
                  className="danger-button"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Delete ${selected.name}? This cannot be undone.`)) return;
                    act(
                      () => api(`/api/management/characters/${selected.id}`, { method: "DELETE" }),
                      `${selected.name} deleted.`
                    );
                  }}
                >
                  <Trash2 size={15} /> Delete
                </button>
              </div>
            </form>
          ) : (
            <p className="ledger-empty">Select a character to manage its placement.</p>
          )}
        </div>
      </div>
    </>
  );
}
