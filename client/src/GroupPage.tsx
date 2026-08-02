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
  ItemClassification,
  ItemTrait,
  PresenceMember,
  RoomRole,
  SystemId
} from "@devils-toys/shared";
import type { SlotWeaponDetail } from "@devils-toys/shared";
import { setSlotWeapon, slotIsWeapon, slotWeapon, splitItemLabel, weaponOverrideKey } from "@devils-toys/shared";
import { api } from "./api";
import { CharacterItemEditor } from "./CharacterItemEditor";
import { characterItemsForSlot, weaponTraitSuggestions } from "./character-items";
import { WeaponMark } from "./WeaponMark";
import { WeaponSelector } from "./WeaponSelector";
import { rollableDamage, rollWeapon } from "./weapon-roll";
import { parseGroupObligations, type GroupObligation } from "./group-obligations";
import { parseGroupHirelings, type GroupHireling } from "./group-hirelings";
import { parseGroupStarships, type GroupStarship } from "./group-starships";
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
  images?: StarshipImage[];
  hirelingImages?: HirelingImage[];
  updatedAt: string | null;
}

interface StarshipImage {
  starshipId: string;
  url: string;
  filename: string;
}

interface HirelingImage {
  hirelingId: string;
  url: string;
  filename: string;
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

export const MONOLITH_GROUP_VIEWS = [
  { id: "party", label: "Party Members" },
  { id: "freelancers", label: "Freelancers" },
  { id: "obligations", label: "Group Obligations" },
  { id: "starship", label: "Starship" }
] as const;

export const STANDARD_GROUP_VIEWS = [
  { id: "party", label: "Party Members" },
  { id: "group", label: "Hirelings" }
] as const;

export type GroupView = "group" | (typeof MONOLITH_GROUP_VIEWS)[number]["id"];

export function groupViewsForSystem(system: SystemId) {
  return system === "monolith" ? MONOLITH_GROUP_VIEWS : STANDARD_GROUP_VIEWS;
}

export function defaultGroupView(system: SystemId): GroupView {
  return "party";
}

type GroupObligationField = Exclude<keyof GroupObligation, "id">;

function newObligationId() {
  return globalThis.crypto?.randomUUID?.() ?? `obligation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function newStarshipId() {
  return globalThis.crypto?.randomUUID?.() ?? `starship-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

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
  view = "group"
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
}) {
  const canEditGroup = role === "gm";
  const [definition, setDefinition] = useState<GroupPageDefinition>();
  const [state, setState] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<SaveStatus>("Saved");
  const [error, setError] = useState("");
  // The group page covers the room's log, so a roll made here reports back.
  const [rolled, setRolled] = useState("");
  const [editingHold, setEditingHold] = useState<{ index: number; value: string }>();
  const [editingStarshipId, setEditingStarshipId] = useState<string>();
  const [starshipExpansion, setStarshipExpansion] = useState<Record<string, boolean>>(() => {
    const storage = typeof localStorage === "undefined" ? undefined : localStorage;
    return readStarshipExpansion(storage, roomId, viewerId);
  });
  const [starshipImages, setStarshipImages] = useState<StarshipImage[]>([]);
  const [busyStarshipImageId, setBusyStarshipImageId] = useState<string>();
  const [partyCharacters, setPartyCharacters] = useState<ReadOnlyCharacter[]>([]);
  const [partyDefinition, setPartyDefinition] = useState<CharacterSheetDefinition>();
  const [partyLabel, setPartyLabel] = useState("Party");
  const [partyLoading, setPartyLoading] = useState(true);
  const [partyError, setPartyError] = useState("");
  const [expandedPartyMembers, setExpandedPartyMembers] = useState<ReadonlySet<number>>(new Set());
  const [expandedHirelings, setExpandedHirelings] = useState<ReadonlySet<string>>(new Set());
  const [editingHirelingMaximums, setEditingHirelingMaximums] = useState<string>();
  const [editingHirelingSlot, setEditingHirelingSlot] = useState<{ id: string; listKey: string; index: number }>();
  const [hirelingImages, setHirelingImages] = useState<HirelingImage[]>([]);
  const [busyHirelingImageId, setBusyHirelingImageId] = useState<string>();
  const [rollingHireling, setRollingHireling] = useState(false);
  const [holdError, setHoldError] = useState("");
  const saveTimerRef = useRef<number | undefined>(undefined);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const latestStateRef = useRef<Record<string, unknown>>({});
  const [itemCatalogue, setItemCatalogue] = useState<Record<string, CharacterItem[]>>({});
  const editVersionRef = useRef(0);
  const dirtyRef = useRef(false);
  const updatedAtRef = useRef<string | null>(null);

  async function load() {
    const response = await api<GroupResponse>(`/api/rooms/${roomId}/group`);
    setDefinition(response.definition);
    setItemCatalogue(response.itemCatalogue ?? {});
    setState(response.state);
    setStarshipImages(response.images ?? []);
    setHirelingImages(response.hirelingImages ?? []);
    latestStateRef.current = response.state;
    updatedAtRef.current = response.updatedAt;
    dirtyRef.current = false;
    setStatus("Saved");
    setError("");
  }

  useEffect(() => {
    void load().catch((cause: Error) => setError(cause.message));
    return () => {
      window.clearTimeout(saveTimerRef.current);
      if (canEditGroup && dirtyRef.current) {
        void api<{ updatedAt: string }>(`/api/rooms/${roomId}/group`, {
          method: "PATCH",
          body: JSON.stringify({ state: latestStateRef.current, updatedAt: updatedAtRef.current })
        });
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
            dirtyRef.current = false;
            setStatus("Saved");
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

  function updateObligations(updater: (current: GroupObligation[]) => GroupObligation[]) {
    updateState((current) => {
      const next: Record<string, unknown> = {
        ...current,
        obligations: updater(parseGroupObligations(current))
      };
      delete next.groupDebt;
      return next;
    });
  }

  function addObligation() {
    updateObligations((current) => [
      ...current,
      { id: newObligationId(), name: "", owedTo: "", amount: "", details: "" }
    ]);
  }

  function setObligationField(id: string, field: GroupObligationField, value: string) {
    updateObligations((current) =>
      current.map((obligation) => (obligation.id === id ? { ...obligation, [field]: value } : obligation))
    );
  }

  function removeObligation(id: string) {
    updateObligations((current) => current.filter((obligation) => obligation.id !== id));
  }

  function updateHirelings(updater: (current: GroupHireling[]) => GroupHireling[]) {
    updateState((current) => ({ ...current, hirelings: updater(parseGroupHirelings(current)) }));
  }

  function addHireling() {
    const id = globalThis.crypto?.randomUUID?.() ?? `hireling-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    updateHirelings((current) => [...current, { id, name: "" }]);
    setExpandedHirelings((current) => new Set(current).add(id));
  }

  async function rollHireling() {
    if (!canEditGroup) return;
    setRollingHireling(true);
    setError("");
    try {
      const response = await api<{ hireling: Record<string, unknown> }>(`/api/rooms/${roomId}/group/hirelings/roll`, {
        method: "POST"
      });
      const id = globalThis.crypto?.randomUUID?.() ?? `hireling-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      updateHirelings((current) => [
        ...current,
        { ...response.hireling, id, name: String(response.hireling.name ?? "") }
      ]);
      setExpandedHirelings((current) => new Set(current).add(id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Freelancer creation failed.");
    } finally {
      setRollingHireling(false);
    }
  }

  function setHirelingField(id: string, key: string, value: unknown) {
    updateHirelings((current) => current.map((entry) => (entry.id === id ? { ...entry, [key]: value } : entry)));
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

  function setHirelingListItem(id: string, key: string, index: number, value: string, weapon?: SlotWeaponDetail) {
    updateHirelings((current) =>
      current.map((entry) => {
        if (entry.id !== id) return entry;
        const list = Array.isArray(entry[key]) ? [...(entry[key] as unknown[])] : [];
        list[index] = value;
        const records = setSlotWeapon(entry, key, index, weapon);
        return { ...entry, [key]: list, [weaponOverrideKey(key)]: records.length ? records : undefined };
      })
    );
  }

  function toggleHireling(id: string) {
    setExpandedHirelings((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function uploadHirelingImage(hirelingId: string, file?: File) {
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
      const result = await api<{ image: HirelingImage }>(
        `/api/rooms/${roomId}/group/hirelings/${encodeURIComponent(hirelingId)}/image`,
        { method: "POST", body }
      );
      setHirelingImages((current) => [...current.filter((image) => image.hirelingId !== hirelingId), result.image]);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusyHirelingImageId(undefined);
    }
  }

  async function removeHirelingImage(hirelingId: string) {
    if (!canEditGroup) return;
    setBusyHirelingImageId(hirelingId);
    setError("");
    try {
      await api<void>(`/api/rooms/${roomId}/group/hirelings/${encodeURIComponent(hirelingId)}/image`, {
        method: "DELETE"
      });
      setHirelingImages((current) => current.filter((image) => image.hirelingId !== hirelingId));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusyHirelingImageId(undefined);
    }
  }

  async function removeHireling(hirelingId: string) {
    if (!canEditGroup) return;
    setError("");
    try {
      await api(`/api/rooms/${roomId}/group/hirelings/${encodeURIComponent(hirelingId)}`, { method: "DELETE" });
      setHirelingImages((current) => current.filter((image) => image.hirelingId !== hirelingId));
      setEditingHirelingMaximums((current) => (current?.startsWith(`${hirelingId}:`) ? undefined : current));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Hireling removal failed.");
    }
  }

  function updateStarships(updater: (current: GroupStarship[]) => GroupStarship[]) {
    updateState((current) => {
      const next: Record<string, unknown> = {
        ...current,
        starships: updater(parseGroupStarships(current))
      };
      delete next.starship;
      return next;
    });
  }

  function addStarship() {
    const id = newStarshipId();
    updateStarships((current) => [...current, { id, name: "" }]);
    setEditingStarshipId(id);
  }

  function setStarshipField(shipId: string, key: string, value: unknown) {
    updateStarships((current) => current.map((ship) => (ship.id === shipId ? { ...ship, [key]: value } : ship)));
  }

  function setStarshipListItem(shipId: string, key: string, index: number, value: string) {
    updateStarships((current) =>
      current.map((ship) => {
        if (ship.id !== shipId) return ship;
        const list = Array.isArray(ship[key]) ? [...(ship[key] as unknown[])] : [];
        list[index] = value;
        return { ...ship, [key]: list };
      })
    );
  }

  function toggleStarship(shipId: string) {
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

  async function uploadStarshipImage(shipId: string, file?: File) {
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
      const result = await api<{ image: StarshipImage }>(
        `/api/rooms/${roomId}/group/starships/${encodeURIComponent(shipId)}/image`,
        { method: "POST", body }
      );
      setStarshipImages((current) => [...current.filter((image) => image.starshipId !== shipId), result.image]);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusyStarshipImageId(undefined);
    }
  }

  async function removeStarshipImage(shipId: string) {
    setBusyStarshipImageId(shipId);
    setError("");
    try {
      await api<void>(`/api/rooms/${roomId}/group/starships/${encodeURIComponent(shipId)}/image`, {
        method: "DELETE"
      });
      setStarshipImages((current) => current.filter((image) => image.starshipId !== shipId));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusyStarshipImageId(undefined);
    }
  }

  /** Installs a part through the hold rules, reporting a refusal rather than forcing it. */
  function installHold(
    shipId: string,
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
    updateStarships((current) =>
      current.map((entry) => (entry.id === shipId ? { ...entry, [list.key]: result.slots } : entry))
    );
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
            updateStarships((current) =>
              current.map((entry) =>
                entry.id === ship.id ? { ...applyStarshipSize(entry, sheet, event.target.value), id: entry.id } : entry
              )
            )
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
    const image = starshipImages.find((candidate) => candidate.starshipId === ship.id);
    const shipName = String(ship.name || "").trim() || "Starship";
    return (
      <div className="group-starship-readout">
        <div className={`group-starship-image-frame${image ? " has-image" : ""}`}>
          {image ? <img src={image.url} alt={`${shipName} starship`} /> : <Rocket aria-hidden="true" />}
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

  const starships = parseGroupStarships(state);
  const editingStarship = starships.find((ship) => ship.id === editingStarshipId);
  const editingHoldCapacity = editingStarship
    ? starshipHolds(definition.starshipSheet, editingStarship.size)
    : undefined;
  const editingStarshipImage = editingStarship
    ? starshipImages.find((image) => image.starshipId === editingStarship.id)
    : undefined;
  const partsList = definition.starshipSheet?.partsList;
  const isMonolith = system === "monolith";
  const obligations = parseGroupObligations(state);
  const hirelings = parseGroupHirelings(state);
  const pageTitle =
    view === "party"
      ? "Party Members"
      : isMonolith
        ? (MONOLITH_GROUP_VIEWS.find((option) => option.id === view)?.label ?? "Group Obligations")
        : (definition.hirelings?.label ?? "Group");

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

      {isMonolith && view === "obligations" && (
        <section className="group-obligations" aria-label="Group obligations">
          <header className="group-obligations-toolbar">
            <div>
              <span>{obligations.length === 1 ? "1 obligation" : `${obligations.length} obligations`}</span>
              {rulesLink("Group Debt")}
            </div>
            <button type="button" className="primary-button" onClick={addObligation} disabled={!canEditGroup}>
              <Plus aria-hidden="true" /> Add obligation
            </button>
          </header>
          {obligations.length === 0 ? (
            <p className="group-obligations-empty">No obligations recorded.</p>
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

      {view !== "party" &&
        !isMonolith &&
        definition.sections.map((section) => (
          <fieldset key={section.id}>
            <legend>{section.label}</legend>
            <div className="character-sheet-fields">
              {section.fields.map((field) => renderField(section, field, state, setGroupField, field.rulesQuery))}
            </div>
          </fieldset>
        ))}

      {view !== "party" && (!isMonolith || view === "freelancers") && definition.hirelings && (
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
              {isMonolith && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void rollHireling()}
                  disabled={!canEditGroup || rollingHireling}
                >
                  <Dices aria-hidden="true" /> {rollingHireling ? "Rollingâ€¦" : "Roll freelancer"}
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
                const image = hirelingImages.find((candidate) => candidate.hirelingId === hireling.id);
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
                        <div className={`group-hireling-image-frame${image ? " has-image" : ""}`}>
                          {image ? <img src={image.url} alt={`${label} portrait`} /> : <UserRound aria-hidden="true" />}
                          <div className="group-image-actions">
                            <label title={image ? `Replace ${label} portrait` : `Upload ${label} portrait`}>
                              <ImagePlus aria-hidden="true" />
                              <span>{image ? "Replace" : "Upload image"}</span>
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
                            {image && (
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
                                                  String(hireling.name ?? "Hireling"),
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

      {view !== "party" && (!isMonolith || view === "starship") && definition.starshipSheet && (
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
                  src={editingStarshipImage.url}
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
