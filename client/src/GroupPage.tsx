import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Dices,
  ImagePlus,
  Pencil,
  Plus,
  Rocket,
  Trash2,
  UserRound,
  UsersRound
} from "lucide-react";
import type {
  CharacterFieldDefinition,
  CharacterItem,
  CharacterListDefinition,
  CharacterSheetDefinition,
  ChatMessage,
  GroupPageDefinition,
  GroupSheetSection,
  GroupViewOption,
  ItemClassification,
  ItemTrait,
  PresenceMember,
  RoomRole,
  SystemId
} from "@devils-toys/shared";
import type { SlotWeaponDetail } from "@devils-toys/shared";
import {
  groupViewsForDefinition,
  HIRELINGS_VIEW,
  PARTY_VIEW,
  setSlotWeapon,
  slotIsWeapon,
  slotWeapon,
  splitItemLabel,
  weaponOverrideKey
} from "@devils-toys/shared";
import { api } from "./api";
import { CharacterItemEditor } from "./CharacterItemEditor";
import { characterItemsForSlot, weaponTraitSuggestions } from "./character-items";
import { WeaponMark } from "./WeaponMark";
import { WeaponSelector } from "./WeaponSelector";
import { rollableDamage, rollWeapon } from "./weapon-roll";
import {
  flattenRow,
  flattenRows,
  splitRow,
  type GroupAsset as GroupStarship,
  type GroupEntry,
  type GroupHireling,
  type GroupObligation,
  type GroupSheetRow
} from "./group-rows";
import { Modal } from "./Modal";
import { otherPartyMembers, partyMemberIsOnline } from "./party-members";
import { ReadOnlyCharacterSheet, type ReadOnlyCharacter } from "./ReadOnlyCharacterSheet";
import { headingSlug, rulesAnchorPath, rulesQueryForField } from "./rules";
import { readStarshipExpansion, writeStarshipExpansion } from "./starship-expansion";
import { applyStarshipSize, holdSlots, setHoldValue, starshipHolds, starshipSizeFor } from "./starship";
import { HoldEditor } from "./StarshipHoldEditor";
import "./GroupPage.css";

interface GroupResponse {
  state: Record<string, unknown>;
  definition: GroupPageDefinition;
  /** The system's own gear, keyed by sheet list, for filling a hireling's slots. */
  itemCatalogue?: Record<string, CharacterItem[]>;
  hirelings?: GroupSheetRow[];
  assets?: GroupSheetRow[];
  obligations?: GroupObligation[];
  updatedAt: string | null;
}

/** Which roster a row belongs to, and so which routes reach it. */
type RosterKind = "hirelings" | "assets" | "obligations";

/** What a row route answers with, whichever roster it was. */
interface SavedRow {
  hireling?: GroupSheetRow;
  asset?: GroupSheetRow;
  obligation?: GroupObligation;
}

/** The writes still owed to one row, and what the last of them established. */
interface RowSave {
  /** Runs this row's writes one after another rather than all at once. */
  chain: Promise<void>;
  /** How many of them are queued or in flight. */
  pending: number;
  /** The revision the row's last write produced, once one has answered. */
  revision?: number;
}

interface PartyCharacterResponse {
  characters: ReadOnlyCharacter[];
  activeCharacterId: number | null;
  partyLabel: string;
  sheetDefinition: CharacterSheetDefinition;
}

type SaveStatus = "Saved" | "Unsaved" | "Saving…";
const groupImageLimitBytes = 5 * 1024 * 1024;
const groupImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

function pairedStatRows(section: CharacterSheetDefinition["sections"][number]) {
  return section.fields.flatMap((currentField) => {
    if (!currentField.key.endsWith("Current")) return [];
    const statKey = currentField.key.slice(0, -"Current".length);
    const maximumField = section.fields.find((field) => field.key === `${statKey}Max`);
    return maximumField ? [{ label: currentField.label.replace(/\s+current$/i, ""), currentField, maximumField }] : [];
  });
}

function fieldWidthClass(kind: CharacterFieldDefinition["kind"]) {
  if (kind === "textarea") return "wide-field";
  if (kind === "number" || kind === "checkbox") return "narrow-field";
  return "";
}

function fixedValue(value: unknown) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  const text = String(value ?? "").trim();
  return text || "—";
}

/**
 * A view id is whatever the definition names, including an asset kind a system
 * invents, so this is a string rather than a union. It used to be derived from a
 * list of Monolith's own tabs, which meant a system could only have the tabs
 * Monolith has.
 */
export type GroupView = string;

export function defaultGroupView(): GroupView {
  return PARTY_VIEW.id;
}

// Ids come from the database now, so the browser no longer mints one and hopes
// nothing else picked the same.
type GroupObligationField = Exclude<keyof GroupObligation, "id" | "sortOrder" | "updatedAt">;

export function GroupPage({
  roomId,
  system,
  revision,
  characterRevision,
  hidden,
  viewerId,
  role,
  onOpenCharacter,
  onRolled,
  traits,
  presence,
  view = PARTY_VIEW.id,
  onViewsChange
}: {
  roomId: number;
  system: SystemId;
  revision: number;
  characterRevision: number;
  hidden: boolean;
  viewerId: number;
  role: RoomRole;
  onOpenCharacter?: (characterId: number) => void;
  /** Files a hireling's damage roll in the room's log. */
  onRolled: (message: ChatMessage) => void;
  /** What this system's weapon words mean, for the marks beside its slots. */
  traits: readonly ItemTrait[];
  presence: PresenceMember[];
  view?: GroupView;
  /**
   * The tabs this room's group page offers, reported once its definition has
   * loaded. The picker lives outside this component but the definition is
   * fetched inside it, and only the definition knows what the tabs are.
   */
  onViewsChange?: (views: GroupViewOption[]) => void;
}) {
  const canEditGroup = role === "gm";
  const [definition, setDefinition] = useState<GroupPageDefinition>();
  const [state, setState] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<SaveStatus>("Saved");
  const [error, setError] = useState("");
  // The group page covers the room's log, so a roll made here reports back.
  const [rolled, setRolled] = useState("");
  const [editingHold, setEditingHold] = useState<{ index: number; value: string }>();
  const [editingStarshipId, setEditingStarshipId] = useState<number>();
  const [starshipExpansion, setStarshipExpansion] = useState<Record<string, boolean>>(() => {
    const storage = typeof localStorage === "undefined" ? undefined : localStorage;
    return readStarshipExpansion(storage, roomId, viewerId);
  });
  const [hirelings, setHirelings] = useState<GroupHireling[]>([]);
  const [starships, setStarships] = useState<GroupStarship[]>([]);
  const [obligations, setObligations] = useState<GroupObligation[]>([]);
  const [busyStarshipImageId, setBusyStarshipImageId] = useState<number>();
  const [partyCharacters, setPartyCharacters] = useState<ReadOnlyCharacter[]>([]);
  const [partyDefinition, setPartyDefinition] = useState<CharacterSheetDefinition>();
  const [partyLabel, setPartyLabel] = useState("Party");
  const [partyLoading, setPartyLoading] = useState(true);
  const [partyError, setPartyError] = useState("");
  const [expandedPartyMembers, setExpandedPartyMembers] = useState<ReadonlySet<number>>(new Set());
  const [expandedHirelings, setExpandedHirelings] = useState<ReadonlySet<number>>(new Set());
  const [editingHirelingMaximums, setEditingHirelingMaximums] = useState<string>();
  // One pending save per row, so editing two hirelings at once never makes one
  // wait on the other and never sends one row's fields under another's id.
  const rowSaveTimers = useRef(new Map<string, number>());
  // Two edits to the same row cannot go at once: the second has to carry the
  // revision the first produced, which is only known once the first has answered.
  const rowSaves = useRef(new Map<string, RowSave>());
  const [editingHirelingSlot, setEditingHirelingSlot] = useState<{ id: number; listKey: string; index: number }>();
  const [busyHirelingImageId, setBusyHirelingImageId] = useState<number>();
  const [rollingHireling, setRollingHireling] = useState(false);
  const [holdError, setHoldError] = useState("");
  const saveTimerRef = useRef<number | undefined>(undefined);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const latestStateRef = useRef<Record<string, unknown>>({});
  const [itemCatalogue, setItemCatalogue] = useState<Record<string, CharacterItem[]>>({});
  const editVersionRef = useRef(0);
  const dirtyRef = useRef(false);
  // The group's own fields and its rows save by different routes but share the
  // dirty flag, so each has to know the other is settled before putting it down.
  const stateDirtyRef = useRef(false);
  const updatedAtRef = useRef<string | null>(null);

  async function load() {
    const response = await api<GroupResponse>(`/api/rooms/${roomId}/group`);
    setDefinition(response.definition);
    onViewsChange?.(groupViewsForDefinition(response.definition));
    setItemCatalogue(response.itemCatalogue ?? {});
    setState(response.state);
    setHirelings(flattenRows(response.hirelings ?? []));
    setStarships(flattenRows(response.assets ?? []));
    setObligations(response.obligations ?? []);
    latestStateRef.current = response.state;
    updatedAtRef.current = response.updatedAt;
    // The rows just answered for themselves, so a revision remembered from a
    // write against the previous set of them no longer describes anything.
    rowSaves.current.clear();
    dirtyRef.current = false;
    stateDirtyRef.current = false;
    setStatus("Saved");
    setError("");
  }

  useEffect(() => {
    void load().catch((cause: Error) => setError(cause.message));
    return () => {
      window.clearTimeout(saveTimerRef.current);
      // Only the group's own fields go this way; a row left waiting is the row
      // route's to flush, and sending the state back unchanged would broadcast
      // a change nobody made.
      if (canEditGroup && stateDirtyRef.current) {
        void api<{ updatedAt: string }>(`/api/rooms/${roomId}/group`, {
          method: "PATCH",
          body: JSON.stringify({ state: latestStateRef.current, updatedAt: updatedAtRef.current })
        }).catch(() => undefined);
      }
    };
  }, [roomId, canEditGroup]);

  useEffect(() => {
    const storage = typeof localStorage === "undefined" ? undefined : localStorage;
    setStarshipExpansion(readStarshipExpansion(storage, roomId, viewerId));
  }, [roomId, viewerId]);

  useEffect(() => {
    if (revision > 0 && !dirtyRef.current) void load().catch((cause: Error) => setError(cause.message));
  }, [revision]);

  useEffect(() => {
    if (view !== "party") return;
    let current = true;
    setPartyLoading(true);
    setPartyError("");
    api<PartyCharacterResponse>(`/api/rooms/${roomId}/characters`)
      .then((response) => {
        if (!current) return;
        const party = otherPartyMembers(response.characters, viewerId, response.activeCharacterId);
        setPartyCharacters(party);
        setPartyDefinition(response.sheetDefinition);
        setPartyLabel(response.partyLabel);
        setExpandedPartyMembers((expanded) => {
          const available = new Set(party.map((character) => character.id));
          return new Set([...expanded].filter((id) => available.has(id)));
        });
      })
      .catch((cause: Error) => current && setPartyError(cause.message))
      .finally(() => current && setPartyLoading(false));
    return () => {
      current = false;
    };
  }, [roomId, viewerId, characterRevision, view]);

  function queueSave(next: Record<string, unknown>) {
    if (!canEditGroup) return;
    latestStateRef.current = next;
    dirtyRef.current = true;
    stateDirtyRef.current = true;
    const version = ++editVersionRef.current;
    setStatus("Unsaved");
    setError("");
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      setStatus("Saving…");
      saveChainRef.current = saveChainRef.current
        .then(async () => {
          const saved = await api<{ updatedAt: string }>(`/api/rooms/${roomId}/group`, {
            method: "PATCH",
            body: JSON.stringify({ state: next, updatedAt: updatedAtRef.current })
          });
          updatedAtRef.current = saved.updatedAt;
          if (version === editVersionRef.current) {
            stateDirtyRef.current = false;
            // A row still waiting keeps the page dirty: clearing it here would
            // let a reload land on top of what is still being typed in one.
            const idle = savesIdle();
            if (idle) dirtyRef.current = false;
            setStatus(idle ? "Saved" : "Unsaved");
          }
        })
        .catch((cause: Error) => {
          if (version === editVersionRef.current) setStatus("Unsaved");
          setError(cause.message);
        });
    }, 650);
  }

  function updateState(updater: (current: Record<string, unknown>) => Record<string, unknown>) {
    if (!canEditGroup) return;
    const next = updater(latestStateRef.current);
    latestStateRef.current = next;
    setState(next);
    queueSave(next);
  }

  function setGroupField(key: string, value: unknown) {
    updateState((current) => ({ ...current, [key]: value }));
  }

  /**
   * Save one row, a moment after the typing stops. The debounce is per row, so
   * two rows edited together are two requests rather than one that has to carry
   * both — which is what having rows instead of one document buys.
   */
  function queueRowSave(kind: RosterKind, id: number, body: () => Record<string, unknown>) {
    if (!canEditGroup) return;
    const key = `${kind}:${id}`;
    // Marked dirty for as long as anything is pending, so a change reported over
    // the socket does not reload the roster on top of what is still being typed.
    dirtyRef.current = true;
    setStatus("Unsaved");
    setError("");
    window.clearTimeout(rowSaveTimers.current.get(key));
    rowSaveTimers.current.set(
      key,
      window.setTimeout(() => {
        rowSaveTimers.current.delete(key);
        setStatus("Saving…");
        const entry = rowSaves.current.get(key) ?? { chain: Promise.resolve(), pending: 0 };
        rowSaves.current.set(key, entry);
        entry.pending += 1;
        entry.chain = entry.chain
          .then(async () => {
            // Built here rather than when the edit was made: a write already in
            // flight for this row moves its revision on, and the one captured
            // with the edit would be refused as a write from before that.
            const payload = body();
            if (entry.revision !== undefined) payload.revision = entry.revision;
            const result = await api<SavedRow>(`/api/rooms/${roomId}/group/${kind}/${id}`, {
              method: "PATCH",
              body: JSON.stringify(payload)
            });
            // Carry the revision the write produced, so the next save is judged
            // against it rather than against the one this row was loaded with.
            const saved = result.hireling ?? result.asset ?? result.obligation;
            if (saved) {
              entry.revision = saved.revision;
              noteRevision(kind, id, saved.revision);
            }
            const idle = finishRowSave(key);
            if (idle) dirtyRef.current = false;
            setStatus(idle ? "Saved" : "Unsaved");
          })
          .catch((cause: Error) => {
            // Still dirty: the edit is on the page and not in the database, so a
            // reload must not be allowed to quietly replace it.
            finishRowSave(key);
            setStatus("Unsaved");
            setError(cause.message);
          });
      }, 650)
    );
  }

  /**
   * Whether the page owes the server nothing at all: no group field waiting to
   * go, and no row waiting on a timer or on a reply.
   */
  function savesIdle() {
    return !stateDirtyRef.current && rowSaveTimers.current.size === 0 && rowSaves.current.size === 0;
  }

  /** Retires one finished write, and answers whether it was the last of them. */
  function finishRowSave(key: string) {
    const entry = rowSaves.current.get(key);
    if (entry && --entry.pending <= 0) rowSaves.current.delete(key);
    return savesIdle();
  }

  /** Records the revision a write returned, on whichever roster the row is in. */
  function noteRevision(kind: RosterKind, id: number, revision: number) {
    const bump = <T extends { id: number; revision: number }>(rows: T[]) =>
      rows.map((row) => (row.id === id ? { ...row, revision } : row));
    if (kind === "hirelings") setHirelings(bump);
    else if (kind === "assets") setStarships(bump);
    else setObligations(bump);
  }

  /** Change one entry in a roster locally, then save that row and only that row. */
  function editEntry(
    kind: "hirelings" | "assets",
    setRows: typeof setHirelings,
    id: number,
    change: (entry: GroupEntry) => GroupEntry
  ) {
    if (!canEditGroup) return;
    let saved: GroupEntry | undefined;
    setRows((current) =>
      current.map((entry) => {
        if (entry.id !== id) return entry;
        saved = change(entry);
        return saved;
      })
    );
    queueRowSave(kind, id, () => ({ ...splitRow(saved!), revision: saved!.revision }));
  }

  function updateObligations(updater: (current: GroupObligation[]) => GroupObligation[]) {
    if (!canEditGroup) return;
    setObligations(updater);
  }

  async function addObligation() {
    if (!canEditGroup) return;
    setError("");
    try {
      const result = await api<{ obligation: GroupObligation }>(`/api/rooms/${roomId}/group/obligations`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setObligations((current) => [...current, result.obligation]);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  function setObligationField(id: number, field: GroupObligationField, value: string) {
    if (!canEditGroup) return;
    // The whole row goes, not the field last touched: the save is debounced per
    // row, so typing a name and then an amount within one window would otherwise
    // send only the amount and leave the name behind.
    let saved: GroupObligation | undefined;
    updateObligations((current) =>
      current.map((obligation) => {
        if (obligation.id !== id) return obligation;
        saved = { ...obligation, [field]: value };
        return saved;
      })
    );
    queueRowSave("obligations", id, () => ({
      name: saved!.name,
      owedTo: saved!.owedTo,
      amount: saved!.amount,
      details: saved!.details,
      revision: saved!.revision
    }));
  }

  async function removeObligation(id: number) {
    if (!canEditGroup) return;
    setError("");
    try {
      await api(`/api/rooms/${roomId}/group/obligations/${id}`, { method: "DELETE" });
      setObligations((current) => current.filter((obligation) => obligation.id !== id));
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function addHireling() {
    if (!canEditGroup) return;
    setError("");
    try {
      const result = await api<{ hireling: GroupSheetRow }>(`/api/rooms/${roomId}/group/hirelings`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setHirelings((current) => [...current, flattenRow(result.hireling)]);
      setExpandedHirelings((current) => new Set(current).add(result.hireling.id));
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function rollHireling() {
    if (!canEditGroup) return;
    setRollingHireling(true);
    setError("");
    try {
      const response = await api<{ hireling: Record<string, unknown> }>(`/api/rooms/${roomId}/group/hirelings/roll`, {
        method: "POST"
      });
      const { name, ...sheet } = response.hireling;
      const created = await api<{ hireling: GroupSheetRow }>(`/api/rooms/${roomId}/group/hirelings`, {
        method: "POST",
        body: JSON.stringify({ name: String(name ?? ""), sheet })
      });
      setHirelings((current) => [...current, flattenRow(created.hireling)]);
      setExpandedHirelings((current) => new Set(current).add(created.hireling.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Freelancer creation failed.");
    } finally {
      setRollingHireling(false);
    }
  }

  function setHirelingField(id: number, key: string, value: unknown) {
    editEntry("hirelings", setHirelings, id, (entry) => ({ ...entry, [key]: value }));
  }

  /** Slot text and its weapon record move together, as they do on a character sheet. */
  /** Anyone at the table may swing a hireling: they are the party's, not one player's. */
  async function rollHirelingWeapon(holder: string, name: string, held: ItemClassification) {
    setError("");
    try {
      const message = await rollWeapon(roomId, holder, { name, damage: held.damage!, traits: held.traits });
      setRolled(message.body);
      onRolled(message);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  function setHirelingListItem(id: number, key: string, index: number, value: string, weapon?: SlotWeaponDetail) {
    editEntry("hirelings", setHirelings, id, (entry) => {
      const list = Array.isArray(entry[key]) ? [...(entry[key] as unknown[])] : [];
      list[index] = value;
      const records = setSlotWeapon(entry, key, index, weapon);
      return { ...entry, [key]: list, [weaponOverrideKey(key)]: records.length ? records : undefined };
    });
  }

  function toggleHireling(id: number) {
    setExpandedHirelings((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function uploadHirelingImage(hirelingId: number, file?: File) {
    if (!canEditGroup) return;
    if (!file) return;
    if (file.size > groupImageLimitBytes) {
      setError("Freelancer images may be at most 5 MB.");
      return;
    }
    if (!groupImageTypes.has(file.type)) {
      setError("Choose a PNG, JPEG, or WebP image.");
      return;
    }

    setBusyHirelingImageId(hirelingId);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const result = await api<{ hireling: GroupSheetRow }>(
        `/api/rooms/${roomId}/group/hirelings/${hirelingId}/image`,
        {
          method: "POST",
          body
        }
      );
      setHirelings((current) =>
        current.map((entry) => (entry.id === hirelingId ? flattenRow(result.hireling) : entry))
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusyHirelingImageId(undefined);
    }
  }

  async function removeHirelingImage(hirelingId: number) {
    if (!canEditGroup) return;
    setBusyHirelingImageId(hirelingId);
    setError("");
    try {
      await api<void>(`/api/rooms/${roomId}/group/hirelings/${hirelingId}/image`, { method: "DELETE" });
      setHirelings((current) =>
        current.map((entry) => (entry.id === hirelingId ? { ...entry, imageUrl: null } : entry))
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusyHirelingImageId(undefined);
    }
  }

  async function removeHireling(hirelingId: number) {
    if (!canEditGroup) return;
    setError("");
    try {
      await api(`/api/rooms/${roomId}/group/hirelings/${hirelingId}`, { method: "DELETE" });
      setHirelings((current) => current.filter((entry) => entry.id !== hirelingId));
      setEditingHirelingMaximums((current) => (current?.startsWith(`${hirelingId}:`) ? undefined : current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Hireling removal failed.");
    }
  }

  async function addStarship() {
    if (!canEditGroup) return;
    setError("");
    try {
      const result = await api<{ asset: GroupSheetRow }>(`/api/rooms/${roomId}/group/assets`, {
        method: "POST",
        body: JSON.stringify({ kind: "starship" })
      });
      setStarships((current) => [...current, flattenRow(result.asset)]);
      setEditingStarshipId(result.asset.id);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  function setStarshipField(shipId: number, key: string, value: unknown) {
    editEntry("assets", setStarships, shipId, (ship) => ({ ...ship, [key]: value }));
  }

  function setStarshipListItem(shipId: number, key: string, index: number, value: string) {
    editEntry("assets", setStarships, shipId, (ship) => {
      const list = Array.isArray(ship[key]) ? [...(ship[key] as unknown[])] : [];
      list[index] = value;
      return { ...ship, [key]: list };
    });
  }

  function toggleStarship(shipId: number) {
    setStarshipExpansion((current) => {
      const next = { ...current, [shipId]: !(current[shipId] ?? true) };
      const storage = typeof localStorage === "undefined" ? undefined : localStorage;
      writeStarshipExpansion(storage, roomId, viewerId, next);
      return next;
    });
  }

  function togglePartyMember(characterId: number) {
    setExpandedPartyMembers((current) => {
      const next = new Set(current);
      if (next.has(characterId)) next.delete(characterId);
      else next.add(characterId);
      return next;
    });
  }

  function closeStarshipEditor() {
    setEditingStarshipId(undefined);
    setEditingHold(undefined);
    setHoldError("");
  }

  async function uploadStarshipImage(shipId: number, file?: File) {
    if (!canEditGroup) return;
    if (!file) return;
    if (file.size > groupImageLimitBytes) {
      setError("Starship images may be at most 5 MB.");
      return;
    }
    if (!groupImageTypes.has(file.type)) {
      setError("Choose a PNG, JPEG, or WebP image.");
      return;
    }

    setBusyStarshipImageId(shipId);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const result = await api<{ asset: GroupSheetRow }>(`/api/rooms/${roomId}/group/assets/${shipId}/image`, {
        method: "POST",
        body
      });
      setStarships((current) => current.map((ship) => (ship.id === shipId ? flattenRow(result.asset) : ship)));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusyStarshipImageId(undefined);
    }
  }

  async function removeStarshipImage(shipId: number) {
    setBusyStarshipImageId(shipId);
    setError("");
    try {
      await api<void>(`/api/rooms/${roomId}/group/assets/${shipId}/image`, { method: "DELETE" });
      setStarships((current) => current.map((ship) => (ship.id === shipId ? { ...ship, imageUrl: null } : ship)));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusyStarshipImageId(undefined);
    }
  }

  /** Installs a part through the hold rules, reporting a refusal rather than forcing it. */
  function installHold(
    shipId: number,
    list: CharacterListDefinition,
    index: number,
    value: string,
    bulky: boolean,
    capacity: number | undefined,
    ship: GroupStarship
  ) {
    const holds = capacity ?? list.slots.length;
    const result = setHoldValue(holdSlots(ship, list.key, holds), index, value, {
      bulky,
      capacity: holds,
      slotName: (position) => list.slots[position] ?? `Hold ${position + 1}`
    });
    if (!result.ok) return setHoldError(result.error);
    editEntry("assets", setStarships, shipId, (entry) => ({ ...entry, [list.key]: result.slots }));
    setEditingHold(undefined);
    setHoldError("");
  }

  function rulesLink(query: string, label = "Rules") {
    return (
      <a
        className="group-rules-link"
        href={rulesAnchorPath(system, roomId, headingSlug(query))}
        target="_blank"
        rel="noreferrer"
        title={`Open ${query} in the rules`}
      >
        {label} <ArrowUpRight aria-hidden="true" />
      </a>
    );
  }

  function renderField(
    section: GroupSheetSection | CharacterSheetDefinition["sections"][number],
    field: CharacterFieldDefinition,
    values: Record<string, unknown>,
    setField: (key: string, value: unknown) => void,
    rulesQuery?: string
  ) {
    const fieldId = `group-${section.id}-${field.key}`;
    return (
      <div className={`character-sheet-field ${fieldWidthClass(field.kind)}`} key={field.key}>
        <span className="character-field-label">
          <label htmlFor={fieldId}>{field.label}</label>
          {rulesQuery && rulesLink(rulesQuery)}
        </span>
        {field.kind === "checkbox" ? (
          <input
            id={fieldId}
            type="checkbox"
            checked={values[field.key] === true}
            disabled={!canEditGroup}
            onChange={(event) => setField(field.key, event.target.checked)}
          />
        ) : field.kind === "textarea" ? (
          <textarea
            id={fieldId}
            value={String(values[field.key] ?? "")}
            placeholder={field.placeholder}
            readOnly={!canEditGroup}
            onChange={(event) => setField(field.key, event.target.value)}
          />
        ) : (
          <>
            <input
              id={fieldId}
              type={field.kind}
              value={String(values[field.key] ?? "")}
              placeholder={field.placeholder}
              disabled={!canEditGroup}
              onChange={(event) =>
                setField(
                  field.key,
                  field.kind === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value
                )
              }
            />
          </>
        )}
      </div>
    );
  }

  /**
   * Choosing a hull class writes the stats that class fixes. It is a `select`
   * rather than free text because the rules give exactly five sizes.
   */
  function renderStarshipSize(
    section: CharacterSheetDefinition["sections"][number],
    field: CharacterFieldDefinition,
    ship: GroupStarship
  ) {
    const sheet = definition?.starshipSheet;
    const chosen = starshipSizeFor(sheet, ship.size);
    const recorded = String(ship.size ?? "").trim();
    const fieldId = `group-${section.id}-${field.key}`;
    return (
      <div className="character-sheet-field starship-size-field" key={field.key}>
        <span className="character-field-label">
          <label htmlFor={fieldId}>{field.label}</label>
        </span>
        <select
          id={fieldId}
          value={chosen?.id ?? ""}
          disabled={!canEditGroup}
          onChange={(event) =>
            editEntry("assets", setStarships, ship.id, (entry) => ({
              ...entry,
              ...applyStarshipSize(entry, sheet, event.target.value)
            }))
          }
        >
          <option value="">Choose a size…</option>
          {sheet?.sizes?.map((size) => (
            <option value={size.id} key={size.id}>
              {size.label}
            </option>
          ))}
        </select>
        {chosen?.note && <small className="starship-size-note">{chosen.note}</small>}
        {!chosen && recorded && <small className="starship-size-note">Recorded as “{recorded}”</small>}
      </div>
    );
  }

  function renderStarshipSection(section: CharacterSheetDefinition["sections"][number], ship: GroupStarship) {
    return (
      <fieldset key={section.id}>
        <legend>{section.label}</legend>
        {section.layout === "paired-current-max" ? (
          <div className="character-stat-table">
            <div className="character-stat-header">
              <span aria-hidden="true" />
              <span>Current</span>
              <span>Max</span>
            </div>
            {pairedStatRows(section).map(({ label, currentField, maximumField }) => (
              <div className="character-stat-row" role="group" aria-label={label} key={currentField.key}>
                <span className="character-stat-name">{label}</span>
                <div className="character-stat-values">
                  <input
                    type="number"
                    aria-label={`${label} current`}
                    value={String(ship[currentField.key] ?? "")}
                    disabled={!canEditGroup}
                    onChange={(event) =>
                      setStarshipField(
                        ship.id,
                        currentField.key,
                        event.target.value === "" ? "" : Number(event.target.value)
                      )
                    }
                  />
                  <input
                    type="number"
                    aria-label={`${label} maximum`}
                    value={String(ship[maximumField.key] ?? "")}
                    disabled={!canEditGroup}
                    onChange={(event) =>
                      setStarshipField(
                        ship.id,
                        maximumField.key,
                        event.target.value === "" ? "" : Number(event.target.value)
                      )
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="character-sheet-fields">
            {section.fields.map((field) =>
              field.key === "size" && definition?.starshipSheet?.sizes?.length
                ? renderStarshipSize(section, field, ship)
                : renderField(section, field, ship, (key, value) => setStarshipField(ship.id, key, value))
            )}
          </div>
        )}
      </fieldset>
    );
  }

  function renderStarshipReadout(ship: GroupStarship) {
    const sheet = definition?.starshipSheet;
    const capacity = starshipHolds(sheet, ship.size);
    const imageUrl = ship.imageUrl;
    const shipName = String(ship.name || "").trim() || "Starship";
    return (
      <div className="group-starship-readout">
        <div className={`group-starship-image-frame${imageUrl ? " has-image" : ""}`}>
          {imageUrl ? <img src={imageUrl} alt={`${shipName} starship`} /> : <Rocket aria-hidden="true" />}
        </div>
        <div className="group-starship-readout-sections">
          {sheet?.sections.map((section) => (
            <section key={section.id}>
              <h4>{section.label}</h4>
              <dl>
                {section.layout === "paired-current-max"
                  ? pairedStatRows(section).map(({ label, currentField, maximumField }) => (
                      <div key={currentField.key}>
                        <dt>{label}</dt>
                        <dd>
                          {fixedValue(ship[currentField.key])} / {fixedValue(ship[maximumField.key])}
                        </dd>
                      </div>
                    ))
                  : section.fields.map((field) => (
                      <div className={field.kind === "textarea" ? "wide" : ""} key={field.key}>
                        <dt>{field.label}</dt>
                        <dd>{fixedValue(ship[field.key])}</dd>
                      </div>
                    ))}
              </dl>
            </section>
          ))}
          {sheet?.lists.map((list) => {
            const visibleSlots = capacity ? list.slots.slice(0, capacity) : list.slots;
            const occupied = visibleSlots.flatMap((slot, index) => {
              const value = String((Array.isArray(ship[list.key]) ? (ship[list.key] as unknown[])[index] : "") ?? "");
              return value.trim() ? [{ slot, value }] : [];
            });
            return (
              <section key={list.key}>
                <h4>{list.label}</h4>
                {occupied.length ? (
                  <dl>
                    {occupied.map(({ slot, value }) => (
                      <div key={slot}>
                        <dt>{slot}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p>No occupied holds.</p>
                )}
              </section>
            );
          })}
        </div>
      </div>
    );
  }

  if (!definition)
    return (
      <div className="group-page" hidden={hidden}>
        <p className={error ? "form-error" : "group-loading"}>{error || "Opening the group ledger…"}</p>
      </div>
    );

  const editingStarship = starships.find((ship) => ship.id === editingStarshipId);
  const editingHoldCapacity = editingStarship
    ? starshipHolds(definition.starshipSheet, editingStarship.size)
    : undefined;
  const editingStarshipImage = editingStarship?.imageUrl ?? undefined;
  const partsList = definition.starshipSheet?.partsList;
  const views = groupViewsForDefinition(definition);
  const pageTitle = views.find((option) => option.id === view)?.label ?? "Group";

  return (
    <div className="group-page character-sheet" hidden={hidden}>
      <header className="group-page-header">
        <h2>{pageTitle}</h2>
        {view === "party" ? (
          <span className="group-save-status">Read only</span>
        ) : (
          <span className={`group-save-status group-save-${status.replace("…", "").toLocaleLowerCase()}`}>
            {status}
          </span>
        )}
      </header>
      {error && <p className="form-error">{error}</p>}
      {rolled && <p className="character-rolled">{rolled}</p>}

      {view === "party" && (
        <section className="group-party" aria-label="Party members">
          <header className="group-party-toolbar">
            <span>
              {partyCharacters.length === 1
                ? `1 other ${partyLabel.toLocaleLowerCase()} member`
                : `${partyCharacters.length} other ${partyLabel.toLocaleLowerCase()} members`}
            </span>
            <small>Active {partyLabel}</small>
          </header>
          {partyLoading ? (
            <p className="group-party-empty">Opening the party roster…</p>
          ) : partyError ? (
            <p className="form-error">{partyError}</p>
          ) : partyCharacters.length === 0 ? (
            <p className="group-party-empty">No other active party members.</p>
          ) : (
            <div className="group-party-list">
              {partyCharacters.map((character) => {
                const expanded = expandedPartyMembers.has(character.id);
                const detailsId = `group-party-character-${character.id}`;
                const online = partyMemberIsOnline(character, presence);
                return (
                  <article className={`group-party-entry${expanded ? " expanded" : ""}`} key={character.id}>
                    <header>
                      <button
                        type="button"
                        className="group-party-toggle"
                        onClick={() => togglePartyMember(character.id)}
                        aria-expanded={expanded}
                        aria-controls={detailsId}
                      >
                        <UsersRound aria-hidden="true" />
                        <span>
                          <strong>{character.name}</strong>
                          <small>
                            {character.activeBy.map((member) => member.displayName).join(", ") ||
                              character.ownerUsername ||
                              "Unassigned"}
                          </small>
                        </span>
                        <span className={`group-party-presence ${online ? "online" : "offline"}`}>
                          <i aria-hidden="true" /> {online ? "Online" : "Offline"}
                        </span>
                        <ChevronDown aria-hidden="true" />
                      </button>
                      {role === "gm" && onOpenCharacter && (
                        <button
                          type="button"
                          className="group-party-open"
                          onClick={() => onOpenCharacter(character.id)}
                        >
                          Open sheet
                        </button>
                      )}
                    </header>
                    {expanded && partyDefinition && (
                      <div id={detailsId}>
                        <ReadOnlyCharacterSheet character={character} definition={partyDefinition} system={system} />
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {definition.obligations && view === "obligations" && (
        <section className="group-obligations" aria-label="Group obligations">
          <header className="group-obligations-toolbar">
            <div>
              <span>
                {obligations.length === 1
                  ? `1 ${definition.obligations.singularLabel.toLowerCase()}`
                  : `${obligations.length} ${definition.obligations.label.toLowerCase()}`}
              </span>
              {definition.obligations.rulesQuery && rulesLink(definition.obligations.rulesQuery)}
            </div>
            <button type="button" className="primary-button" onClick={addObligation} disabled={!canEditGroup}>
              <Plus aria-hidden="true" /> Add {definition.obligations.singularLabel.toLowerCase()}
            </button>
          </header>
          {obligations.length === 0 ? (
            <p className="group-obligations-empty">{definition.obligations.emptyHint ?? "None recorded."}</p>
          ) : (
            <div className="group-obligation-list">
              {obligations.map((obligation, index) => {
                const fieldPrefix = `group-obligation-${index}`;
                return (
                  <fieldset className="group-obligation" key={obligation.id}>
                    <legend>
                      <input
                        className="group-obligation-name"
                        aria-label={`Obligation ${index + 1} name`}
                        value={obligation.name}
                        placeholder={`Obligation ${index + 1}`}
                        disabled={!canEditGroup}
                        onChange={(event) => setObligationField(obligation.id, "name", event.target.value)}
                      />
                      <button
                        type="button"
                        className="group-obligation-remove"
                        onClick={() => removeObligation(obligation.id)}
                        disabled={!canEditGroup}
                        aria-label={`Remove obligation ${index + 1}`}
                      >
                        <Trash2 aria-hidden="true" /> Remove
                      </button>
                    </legend>
                    <div className="group-obligation-fields">
                      <label htmlFor={`${fieldPrefix}-owed-to`}>
                        <span>Owed To</span>
                        <input
                          id={`${fieldPrefix}-owed-to`}
                          value={obligation.owedTo}
                          disabled={!canEditGroup}
                          onChange={(event) => setObligationField(obligation.id, "owedTo", event.target.value)}
                        />
                      </label>
                      <label htmlFor={`${fieldPrefix}-amount`}>
                        <span>Amount</span>
                        <input
                          id={`${fieldPrefix}-amount`}
                          value={obligation.amount}
                          disabled={!canEditGroup}
                          onChange={(event) => setObligationField(obligation.id, "amount", event.target.value)}
                        />
                      </label>
                      <label className="group-obligation-details" htmlFor={`${fieldPrefix}-details`}>
                        <span>Details</span>
                        <textarea
                          id={`${fieldPrefix}-details`}
                          value={obligation.details}
                          readOnly={!canEditGroup}
                          onChange={(event) => setObligationField(obligation.id, "details", event.target.value)}
                        />
                      </label>
                    </div>
                  </fieldset>
                );
              })}
            </div>
          )}
        </section>
      )}

      {view === HIRELINGS_VIEW &&
        definition.sections.map((section) => (
          <fieldset key={section.id}>
            <legend>{section.label}</legend>
            <div className="character-sheet-fields">
              {section.fields.map((field) => renderField(section, field, state, setGroupField, field.rulesQuery))}
            </div>
          </fieldset>
        ))}

      {view === HIRELINGS_VIEW && definition.hirelings && (
        <section className="group-hirelings" aria-labelledby="group-hirelings-heading">
          <header className="group-hirelings-toolbar">
            <div>
              <strong id="group-hirelings-heading">{definition.hirelings.label}</strong>
              <span>
                {hirelings.length === 1
                  ? `1 ${definition.hirelings.singularLabel.toLowerCase()}`
                  : `${hirelings.length} ${definition.hirelings.label.toLowerCase()}`}
              </span>
              {rulesLink(definition.hirelings.rulesQuery, "Creation rules")}
            </div>
            <div className="group-hirelings-actions">
              {/* Offered by a system that states how one is rolled up, which is
                  what the server's roll route needs to answer at all. */}
              {definition.hirelings.creationRoll && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void rollHireling()}
                  disabled={!canEditGroup || rollingHireling}
                >
                  <Dices aria-hidden="true" />{" "}
                  {rollingHireling ? "Rolling…" : `Roll ${definition.hirelings.singularLabel.toLowerCase()}`}
                </button>
              )}
              <button type="button" className="primary-button" onClick={addHireling} disabled={!canEditGroup}>
                <Plus aria-hidden="true" /> Add {definition.hirelings.singularLabel}
              </button>
            </div>
          </header>
          {hirelings.length === 0 ? (
            <p className="group-hirelings-empty">{definition.hirelings.creationHint}</p>
          ) : (
            <div className="group-hireling-list">
              {hirelings.map((hireling, index) => {
                const expanded = expandedHirelings.has(hireling.id);
                const label = String(hireling.name).trim() || `${definition.hirelings!.singularLabel} ${index + 1}`;
                const imageUrl = hireling.imageUrl;
                return (
                  <article className={`group-hireling-entry${expanded ? " expanded" : ""}`} key={hireling.id}>
                    <header>
                      <button
                        type="button"
                        className="group-hireling-toggle"
                        onClick={() => toggleHireling(hireling.id)}
                        aria-expanded={expanded}
                        aria-controls={`group-hireling-${hireling.id}`}
                      >
                        <UsersRound aria-hidden="true" />
                        <span>
                          <strong>{label}</strong>
                          <small>{fixedValue(hireling.weapon)}</small>
                        </span>
                        <ChevronDown aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="group-obligation-remove"
                        onClick={() => removeHireling(hireling.id)}
                        disabled={!canEditGroup || busyHirelingImageId === hireling.id}
                        aria-label={`Remove ${label}`}
                      >
                        <Trash2 aria-hidden="true" /> Remove
                      </button>
                    </header>
                    {expanded && (
                      <div className="group-hireling-sheet" id={`group-hireling-${hireling.id}`}>
                        <div className={`group-hireling-image-frame${imageUrl ? " has-image" : ""}`}>
                          {imageUrl ? (
                            <img src={imageUrl} alt={`${label} portrait`} />
                          ) : (
                            <UserRound aria-hidden="true" />
                          )}
                          <div className="group-image-actions">
                            <label title={imageUrl ? `Replace ${label} portrait` : `Upload ${label} portrait`}>
                              <ImagePlus aria-hidden="true" />
                              <span>{imageUrl ? "Replace" : "Upload image"}</span>
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                                disabled={!canEditGroup || busyHirelingImageId === hireling.id}
                                onChange={(event) => {
                                  const file = event.target.files?.[0];
                                  event.target.value = "";
                                  void uploadHirelingImage(hireling.id, file);
                                }}
                              />
                            </label>
                            {imageUrl && (
                              <button
                                type="button"
                                onClick={() => void removeHirelingImage(hireling.id)}
                                disabled={!canEditGroup || busyHirelingImageId === hireling.id}
                                aria-label={`Remove ${label} portrait`}
                                title="Remove portrait"
                              >
                                <Trash2 aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </div>
                        {definition.hirelings!.sheet.sections.map((section) => {
                          const maximumEditKey = `${hireling.id}:${section.id}`;
                          const editingMaxima = editingHirelingMaximums === maximumEditKey;
                          return (
                            <fieldset key={section.id}>
                              <legend>{section.label}</legend>
                              {section.layout === "paired-current-max" ? (
                                <div className="character-stat-table">
                                  <div className="character-stat-header">
                                    <span aria-hidden="true" />
                                    <span aria-hidden="true">Current</span>
                                    <span className="character-stat-max-header">
                                      <span aria-hidden="true">Max</span>
                                      <button
                                        type="button"
                                        className="character-stat-max-toggle"
                                        aria-pressed={editingMaxima}
                                        aria-label={
                                          editingMaxima
                                            ? `Finish editing ${section.label} maximums`
                                            : `Edit ${section.label} maximums`
                                        }
                                        title={editingMaxima ? "Done editing maximums" : "Edit maximums"}
                                        onClick={() =>
                                          setEditingHirelingMaximums(editingMaxima ? undefined : maximumEditKey)
                                        }
                                      >
                                        {editingMaxima ? <Check aria-hidden="true" /> : <Pencil aria-hidden="true" />}
                                      </button>
                                    </span>
                                  </div>
                                  {pairedStatRows(section).map(({ label: statLabel, currentField, maximumField }) => (
                                    <div
                                      className="character-stat-row"
                                      role="group"
                                      aria-label={statLabel}
                                      key={currentField.key}
                                    >
                                      <span className="character-stat-name">{statLabel}</span>
                                      <div className="character-stat-values">
                                        <input
                                          type="number"
                                          aria-label={`${statLabel} current`}
                                          value={String(hireling[currentField.key] ?? "")}
                                          disabled={!canEditGroup}
                                          onChange={(event) =>
                                            setHirelingField(
                                              hireling.id,
                                              currentField.key,
                                              event.target.value === "" ? "" : Number(event.target.value)
                                            )
                                          }
                                        />
                                        <input
                                          type="number"
                                          className="character-stat-max"
                                          aria-label={`${statLabel} maximum`}
                                          value={String(hireling[maximumField.key] ?? "")}
                                          disabled={!canEditGroup || !editingMaxima}
                                          onChange={(event) =>
                                            setHirelingField(
                                              hireling.id,
                                              maximumField.key,
                                              event.target.value === "" ? "" : Number(event.target.value)
                                            )
                                          }
                                        />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="character-sheet-fields">
                                  {section.fields.map((field) =>
                                    renderField(
                                      { ...section, id: `${hireling.id}-${section.id}` },
                                      field,
                                      hireling,
                                      (key, value) => setHirelingField(hireling.id, key, value),
                                      // A freelancer's fields read the same rules a character's do.
                                      rulesQueryForField(field.key)
                                    )
                                  )}
                                </div>
                              )}
                            </fieldset>
                          );
                        })}
                        {definition.hirelings!.sheet.lists.map((list) => (
                          <fieldset key={list.key}>
                            <legend>{list.label}</legend>
                            <div className="group-hireling-inventory">
                              {list.slots.map((slot, slotIndex) => {
                                const value = String(
                                  (Array.isArray(hireling[list.key])
                                    ? (hireling[list.key] as unknown[])[slotIndex]
                                    : "") ?? ""
                                );
                                const held = value.trim()
                                  ? slotIsWeapon(value, slotWeapon(hireling, list.key, slotIndex), list)
                                  : undefined;
                                return (
                                  <div className="character-slot" key={slot}>
                                    <label>
                                      <span>{slot}</span>
                                      <input
                                        value={value}
                                        disabled={!canEditGroup}
                                        onChange={(event) =>
                                          setHirelingListItem(hireling.id, list.key, slotIndex, event.target.value)
                                        }
                                      />
                                    </label>
                                    {held && (
                                      <WeaponMark
                                        held={held}
                                        name={splitItemLabel(value).name || value}
                                        traits={traits}
                                        onRoll={
                                          rollableDamage(held)
                                            ? () =>
                                                void rollHirelingWeapon(
                                                  String(hireling.name ?? "").trim() || "Hireling",
                                                  splitItemLabel(value).name || value,
                                                  held
                                                )
                                            : undefined
                                        }
                                      />
                                    )}
                                    {canEditGroup && (
                                      <button
                                        type="button"
                                        className="character-slot-edit"
                                        aria-label={`Choose an item for ${slot}`}
                                        title="Choose an item"
                                        onClick={() =>
                                          setEditingHirelingSlot({
                                            id: hireling.id,
                                            listKey: list.key,
                                            index: slotIndex
                                          })
                                        }
                                      >
                                        <Pencil size={14} aria-hidden="true" />
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            {list === definition!.hirelings!.sheet.lists[0] && (
                              <WeaponSelector
                                sheet={hireling}
                                list={list}
                                canEdit={canEditGroup}
                                onChange={(key, value) => setHirelingField(hireling.id, key, value)}
                              />
                            )}
                            {editingHirelingSlot?.id === hireling.id && editingHirelingSlot.listKey === list.key && (
                              <CharacterItemEditor
                                key={`${hireling.id}-${list.key}-${editingHirelingSlot.index}`}
                                slotName={
                                  list.slots[editingHirelingSlot.index] ?? `Slot ${editingHirelingSlot.index + 1}`
                                }
                                items={characterItemsForSlot(
                                  itemCatalogue[list.key] ?? [],
                                  list,
                                  editingHirelingSlot.index
                                )}
                                current={String(
                                  (Array.isArray(hireling[list.key])
                                    ? (hireling[list.key] as unknown[])[editingHirelingSlot.index]
                                    : "") ?? ""
                                )}
                                currentWeapon={slotWeapon(hireling, list.key, editingHirelingSlot.index)}
                                weaponCategories={list.weaponCategories}
                                weaponRange={list.weaponRange}
                                traitSuggestions={weaponTraitSuggestions(itemCatalogue[list.key] ?? [])}
                                onCancel={() => setEditingHirelingSlot(undefined)}
                                onSubmit={(value, weapon) => {
                                  setHirelingListItem(hireling.id, list.key, editingHirelingSlot.index, value, weapon);
                                  setEditingHirelingSlot(undefined);
                                }}
                              />
                            )}
                          </fieldset>
                        ))}
                        <div className="group-hireling-level">
                          <button type="button" disabled>
                            Level up
                          </button>
                          <small>{definition.hirelings!.levelUpHint}</small>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {view === "starship" && definition.starshipSheet && (
        <section className="group-starships" aria-label="Starships">
          <header className="group-starships-toolbar">
            <span>{starships.length === 1 ? "1 starship" : `${starships.length} starships`}</span>
            {rulesLink("Starships", "Starship rules")}
          </header>
          {starships.length ? (
            <div className="group-starship-list">
              {starships.map((ship, index) => {
                const expanded = starshipExpansion[ship.id] ?? true;
                return (
                  <article className={`group-starship-entry${expanded ? " expanded" : ""}`} key={ship.id}>
                    <header>
                      <button
                        type="button"
                        className="group-starship-toggle"
                        onClick={() => toggleStarship(ship.id)}
                        aria-expanded={expanded}
                        aria-controls={`group-starship-${ship.id}`}
                      >
                        <Rocket aria-hidden="true" />
                        <span>
                          <strong>{String(ship.name || "").trim() || `Starship ${index + 1}`}</strong>
                          <small>{String(ship.size || "").trim() || "Unclassified hull"}</small>
                        </span>
                        <ChevronDown aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="group-starship-edit"
                        onClick={() => setEditingStarshipId(ship.id)}
                        disabled={!canEditGroup}
                        aria-label={`Edit ${String(ship.name || "").trim() || `starship ${index + 1}`}`}
                        title="Edit starship"
                      >
                        <Pencil aria-hidden="true" />
                      </button>
                    </header>
                    {expanded && <div id={`group-starship-${ship.id}`}>{renderStarshipReadout(ship)}</div>}
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="group-starships-empty">No starships recorded.</p>
          )}
          <button type="button" className="group-starship-add" onClick={addStarship} disabled={!canEditGroup}>
            <Plus aria-hidden="true" /> Add starship
          </button>
        </section>
      )}

      {editingStarship && definition.starshipSheet && (
        <Modal
          title={`Edit ${String(editingStarship.name || "").trim() || "starship"}`}
          onClose={closeStarshipEditor}
          wide
        >
          <div className="group-starship group-starship-editor">
            <div
              className={`group-starship-image-frame group-starship-editor-image${editingStarshipImage ? " has-image" : ""}`}
            >
              {editingStarshipImage ? (
                <img
                  src={editingStarshipImage}
                  alt={`${String(editingStarship.name || "").trim() || "Starship"} starship`}
                />
              ) : (
                <Rocket aria-hidden="true" />
              )}
              <div className="group-image-actions">
                <label title={editingStarshipImage ? "Replace starship image" : "Upload starship image"}>
                  <ImagePlus aria-hidden="true" />
                  <span>{editingStarshipImage ? "Replace" : "Upload"}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                    disabled={!canEditGroup || busyStarshipImageId === editingStarship.id}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      void uploadStarshipImage(editingStarship.id, file);
                    }}
                  />
                </label>
                {editingStarshipImage && (
                  <button
                    type="button"
                    onClick={() => void removeStarshipImage(editingStarship.id)}
                    disabled={!canEditGroup || busyStarshipImageId === editingStarship.id}
                    aria-label={`Remove ${String(editingStarship.name || "").trim() || "starship"} image`}
                    title="Remove starship image"
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
            <p className="modal-intro">Changes save automatically.</p>
            {definition.starshipSheet.sections.map((section) => renderStarshipSection(section, editingStarship))}
            {definition.starshipSheet.lists.map((list) => {
              const visibleSlots = editingHoldCapacity ? list.slots.slice(0, editingHoldCapacity) : list.slots;
              return (
                <fieldset key={list.key}>
                  <legend>
                    <span>{list.label}</span>
                    <small>
                      {editingHoldCapacity
                        ? `${editingHoldCapacity} · ${editingStarship.size}`
                        : "Choose a size · showing max"}
                    </small>
                  </legend>
                  <div className="character-list">
                    {visibleSlots.map((slot, index) => (
                      <div
                        className={`starship-hold ${index > 0 && list.groupStarts?.includes(index) ? "character-list-group-start" : ""}`}
                        key={slot}
                      >
                        <label>
                          <span>{slot}</span>
                          <input
                            value={String(
                              (Array.isArray(editingStarship[list.key])
                                ? (editingStarship[list.key] as unknown[])[index]
                                : "") ?? ""
                            )}
                            disabled={!canEditGroup}
                            onChange={(event) =>
                              setStarshipListItem(editingStarship.id, list.key, index, event.target.value)
                            }
                          />
                        </label>
                        {list.key === partsList && (
                          <button
                            type="button"
                            className="starship-hold-edit"
                            aria-label={`Choose a part for ${slot}`}
                            title="Choose a part"
                            disabled={!canEditGroup}
                            onClick={() => {
                              setHoldError("");
                              setEditingHold({ index, value: "" });
                            }}
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {list.key === partsList && editingHold && (
                    <HoldEditor
                      slotName={list.slots[editingHold.index] ?? `Hold ${editingHold.index + 1}`}
                      parts={definition.starshipSheet?.parts ?? []}
                      current={String(
                        (Array.isArray(editingStarship[list.key])
                          ? (editingStarship[list.key] as unknown[])[editingHold.index]
                          : "") ?? ""
                      )}
                      error={holdError}
                      onCancel={() => {
                        setEditingHold(undefined);
                        setHoldError("");
                      }}
                      onSubmit={(value, bulky) =>
                        installHold(
                          editingStarship.id,
                          list,
                          editingHold.index,
                          value,
                          bulky,
                          editingHoldCapacity,
                          editingStarship
                        )
                      }
                    />
                  )}
                </fieldset>
              );
            })}
          </div>
        </Modal>
      )}
    </div>
  );
}
