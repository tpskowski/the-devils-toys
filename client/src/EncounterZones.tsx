import { useEffect, useState, type DragEvent } from "react";
import { GripVertical, Plus, Trash2, X } from "lucide-react";
import { api } from "./api";
import { CombatantAvatar } from "./CombatantAvatar";
import { canControlCombatant } from "./encounter-control";
import type { EncounterCombatant, EncounterRecord } from "./EncounterPage";

/** What a zone's own drag carries, so a drop can tell it from a combatant's. */
const ZONE = "application/x-encounter-zone";

/**
 * The zone board: named places laid out left to right, with everyone in the
 * fight standing in one of them or waiting below.
 *
 * Moving someone is a drag, and also a click — pick a combatant up, then choose
 * where they go. A pointer is not the only thing a table plays on, and HTML's
 * own drag events reach neither a touchscreen nor a keyboard.
 */
export function EncounterZones({
  roomId,
  encounter,
  isGm,
  viewerId,
  onChanged
}: {
  roomId: number;
  encounter: EncounterRecord;
  isGm: boolean;
  viewerId: number;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  // Picked up by a click, which is what puts a "move here" on every zone. A drag
  // needs no such thing — the pointer is already saying where — so it is tracked
  // apart and only marks the token it is carrying.
  const [carried, setCarried] = useState<number>();
  const [dragging, setDragging] = useState<number>();
  const [over, setOver] = useState<number | "none">();
  // A zone being carried to a new place in the row, which is a different drag
  // from a combatant being carried to a new zone.
  const [movingZone, setMovingZone] = useState<number>();
  const [zoneNames, setZoneNames] = useState<Record<number, string>>({});
  const [editingZone, setEditingZone] = useState<number>();

  useEffect(() => {
    setZoneNames((current) => {
      const next = { ...current };
      for (const zone of encounter.zones) if (editingZone !== zone.id) next[zone.id] = zone.name;
      return next;
    });
  }, [encounter.zones, editingZone]);

  /**
   * A player moves their own characters and the party's hirelings; the GM moves
   * anyone, including whatever they are running.
   */
  const canMove = (combatant: EncounterCombatant) => canControlCombatant(combatant, isGm, viewerId);

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await run();
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const place = (combatant: EncounterCombatant, zoneId: number | null) => {
    if (!canMove(combatant) || combatant.zoneId === zoneId) return;
    return act(() =>
      api(`/api/rooms/${roomId}/encounters/${encounter.id}/combatants/${combatant.id}`, {
        method: "PATCH",
        body: JSON.stringify({ zoneId })
      })
    );
  };

  const addZone = () =>
    act(async () => {
      await api(`/api/rooms/${roomId}/encounters/${encounter.id}/zones`, {
        method: "POST",
        body: JSON.stringify({ name: name.trim() })
      });
      setName("");
    });

  const renameZone = (zoneId: number, next: string) =>
    act(() =>
      api(`/api/rooms/${roomId}/encounters/${encounter.id}/zones/${zoneId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: next })
      })
    );

  const removeZone = (zoneId: number) =>
    act(() => api(`/api/rooms/${roomId}/encounters/${encounter.id}/zones/${zoneId}`, { method: "DELETE" }));

  /** Drops the carried zone where the target one stands, and shuffles the rest along. */
  function reorder(zoneId: number, targetId?: number) {
    if (zoneId === targetId) return;
    const order = zones.map((zone) => zone.id).filter((id) => id !== zoneId);
    order.splice(targetId === undefined ? order.length : order.indexOf(targetId), 0, zoneId);
    return act(() =>
      api(`/api/rooms/${roomId}/encounters/${encounter.id}/zones`, {
        method: "PATCH",
        body: JSON.stringify({ order })
      })
    );
  }

  const clearZones = () => {
    if (!confirm("Remove every zone from this encounter? Combatants will remain in the encounter.")) return;
    return act(async () => {
      for (const zone of zones)
        await api(`/api/rooms/${roomId}/encounters/${encounter.id}/zones/${zone.id}`, { method: "DELETE" });
    });
  };

  function drop(event: DragEvent<HTMLElement>, zoneId: number | null) {
    event.preventDefault();
    setOver(undefined);
    setDragging(undefined);
    setMovingZone(undefined);
    // One target, two things that can land on it: a zone being put in a new
    // place, or a combatant being put in this zone.
    const carriedZone = Number(event.dataTransfer.getData(ZONE));
    if (carriedZone && zoneId !== null) return void reorder(carriedZone, zoneId);
    if (carriedZone) return;
    const combatant = encounter.combatants.find(
      (entry) => entry.id === Number(event.dataTransfer.getData("text/plain"))
    );
    if (combatant) void place(combatant, zoneId);
  }

  function token(combatant: EncounterCombatant) {
    const movable = canMove(combatant) && !busy;
    const holding = carried === combatant.id || dragging === combatant.id;
    return (
      <button
        key={combatant.id}
        type="button"
        className={`encounter-token combat-side-${combatant.side === "party" ? "friendly" : "hostile"}${
          holding ? " encounter-token-carried" : ""
        }`}
        draggable={movable}
        disabled={!movable}
        aria-pressed={holding}
        title={movable ? `Move ${combatant.name}` : combatant.name}
        aria-label={movable ? `Move ${combatant.name}` : combatant.name}
        onDragStart={(event) => {
          event.dataTransfer.setData("text/plain", String(combatant.id));
          event.dataTransfer.effectAllowed = "move";
          setDragging(combatant.id);
          setCarried(undefined);
        }}
        onDragEnd={() => setDragging(undefined)}
        onClick={() => setCarried(carried === combatant.id ? undefined : combatant.id)}
      >
        <CombatantAvatar combatant={combatant} />
        <span>{combatant.name}</span>
      </button>
    );
  }

  /** Where a click puts whoever is being carried, once somewhere is chosen. */
  function choose(zoneId: number | null) {
    const combatant = encounter.combatants.find((entry) => entry.id === carried);
    setCarried(undefined);
    if (combatant) void place(combatant, zoneId);
  }

  const waiting = encounter.combatants.filter((combatant) => combatant.zoneId == null);
  const zones = [...encounter.zones].sort((left, right) => left.sortOrder - right.sortOrder);
  // The bench is the GM's staging area, so they always have it. A player is only
  // shown one while something of theirs is still off the board — or while they
  // are carrying someone, since that is the only way back off it.
  const bench = isGm || carried !== undefined || waiting.some(canMove);

  return (
    <div className="encounter-zones">
      {error && <p className="form-error">{error}</p>}
      {zones.length === 0 ? (
        <p className="encounter-zones-empty">
          {isGm ? "No zones yet. Name one below to start the board." : "The GM has not laid out any zones."}
        </p>
      ) : (
        <div className="encounter-zone-row" aria-label="Zones">
          {zones.map((zone, zoneIndex) => (
            <section
              key={zone.id}
              className={`encounter-zone${over === zone.id ? " encounter-zone-over" : ""}${
                movingZone === zone.id ? " encounter-zone-moving" : ""
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                setOver(zone.id);
              }}
              onDragLeave={() => setOver((current) => (current === zone.id ? undefined : current))}
              onDrop={(event) => drop(event, zone.id)}
            >
              <header>
                {isGm && (
                  <span
                    className="encounter-zone-grip"
                    draggable
                    role="button"
                    tabIndex={0}
                    title={`Move ${zone.name}`}
                    aria-label={`Move ${zone.name} along the row`}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(ZONE, String(zone.id));
                      event.dataTransfer.effectAllowed = "move";
                      setMovingZone(zone.id);
                    }}
                    onDragEnd={() => setMovingZone(undefined)}
                  >
                    <GripVertical aria-hidden="true" />
                  </span>
                )}
                {isGm ? (
                  <>
                    <input
                      value={zoneNames[zone.id] ?? zone.name}
                      aria-label={`Zone name`}
                      disabled={busy}
                      onFocus={() => setEditingZone(zone.id)}
                      onChange={(event) => setZoneNames((current) => ({ ...current, [zone.id]: event.target.value }))}
                      onBlur={() => {
                        const next = (zoneNames[zone.id] ?? zone.name).trim();
                        setEditingZone(undefined);
                        if (!next) return setZoneNames((current) => ({ ...current, [zone.id]: zone.name }));
                        if (next !== zone.name) void renameZone(zone.id, next);
                      }}
                    />
                    <span className="encounter-zone-order" aria-label={`Move ${zone.name} along the row`}>
                      <button
                        type="button"
                        disabled={busy || zoneIndex === 0}
                        onClick={() => void reorder(zone.id, zones[zoneIndex - 1]?.id)}
                      >
                        Move left
                      </button>
                      <button
                        type="button"
                        disabled={busy || zoneIndex === zones.length - 1}
                        onClick={() => void reorder(zone.id, zones[zoneIndex + 2]?.id)}
                      >
                        Move right
                      </button>
                    </span>
                  </>
                ) : (
                  <h4>{zone.name}</h4>
                )}
                {isGm && (
                  <button
                    className="danger-text"
                    disabled={busy}
                    title={`Remove ${zone.name}`}
                    aria-label={`Remove ${zone.name}`}
                    onClick={() => void removeZone(zone.id)}
                  >
                    <X />
                  </button>
                )}
              </header>
              <div className="encounter-zone-tokens">
                {encounter.combatants.filter((combatant) => combatant.zoneId === zone.id).map(token)}
              </div>
              {carried !== undefined && (
                <button className="encounter-zone-drop" onClick={() => choose(zone.id)}>
                  Move here
                </button>
              )}
            </section>
          ))}
        </div>
      )}

      {bench && (
        <section
          className={`encounter-zone-bench${over === "none" ? " encounter-zone-over" : ""}`}
          aria-label="Not in a zone"
          onDragOver={(event) => {
            event.preventDefault();
            setOver("none");
          }}
          onDragLeave={() => setOver((current) => (current === "none" ? undefined : current))}
          onDrop={(event) => drop(event, null)}
        >
          <p className="eyebrow">Not placed</p>
          <div className="encounter-zone-tokens">
            {waiting.length === 0 ? <span className="encounter-zones-empty">Everyone is on the board.</span> : null}
            {waiting.map(token)}
          </div>
          {carried !== undefined && zones.length > 0 && (
            <button className="encounter-zone-drop" onClick={() => choose(null)}>
              Take off the board
            </button>
          )}
        </section>
      )}

      {isGm && (
        <form
          className="encounter-zone-add"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) void addZone();
          }}
        >
          <input
            value={name}
            placeholder="Zone name — the gate, the roof, the far bank"
            aria-label="New zone name"
            onChange={(event) => setName(event.target.value)}
          />
          <button className="secondary-button" disabled={busy || !name.trim()}>
            <Plus /> Add zone
          </button>
          {zones.length > 0 && (
            <button
              type="button"
              className="danger-text encounter-zone-clear"
              disabled={busy}
              title="Remove every zone"
              onClick={() => void clearZones()}
            >
              <Trash2 /> Clear
            </button>
          )}
        </form>
      )}
    </div>
  );
}
