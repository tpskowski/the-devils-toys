import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  Dices,
  ImagePlus,
  Pencil,
  Plus,
  Trash2,
  UserMinus,
  UserRound,
  X
} from "lucide-react";
import type {
  CharacterEntry,
  CharacterItem,
  CharacterSheetDefinition,
  CharacterVice,
  SystemId
} from "@devils-toys/shared";
import { api } from "./api";
import { CharacterItemEditor } from "./CharacterItemEditor";
import { RulesMarkdown } from "./RulesMarkdown";
import { appendEntry, entryName, readEntries, removeEntry, singularLabel, updateEntry } from "./character-entries";
import { characterItemsForSlot } from "./character-items";
import { groupRoster } from "./character-roster";
import { currentsToBackfill } from "./character-stats";
import { saveSetupForField, type SaveRollSetup } from "./save-roll";
import { findRuleAnchorId, findRuleExcerpt, rulesAnchorPath } from "./rules";
import "./CharacterModal.css";

interface Character {
  id: number;
  ownerAccountId: number | null;
  ownerUsername: string | null;
  poolRoomId: number | null;
  name: string;
  sheet: Record<string, unknown>;
  portraitUrl: string | null;
  portraitFilename: string | null;
  warnings: string[];
  activeBy: { accountId: number; username: string; displayName: string }[];
  updatedAt: string;
}

interface CharacterResponse {
  characters: Character[];
  activeCharacterId: number | null;
  partyLabel: string;
  sheetDefinition: CharacterSheetDefinition;
  itemCatalogue: Record<string, CharacterItem[]>;
  viceCatalogue: CharacterVice[];
}

interface ActiveRule {
  id: string;
  query: string;
  pinned: boolean;
}

const portraitUploadLimitBytes = 5 * 1024 * 1024;
const portraitTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const newCharacterName = "New character";

function entryHandle(fieldKey: string, index: number) {
  return `${fieldKey}:${index}`;
}

function entryHandlePosition(handle: string, fieldKey: string) {
  if (!handle.startsWith(`${fieldKey}:`)) return undefined;
  const position = Number(handle.slice(fieldKey.length + 1));
  return Number.isInteger(position) ? position : undefined;
}

function rulesQueryForSection(section: CharacterSheetDefinition["sections"][number]) {
  const keys = new Set(section.fields.map((field) => field.key));
  if (keys.has("background")) return "Background";
  if (keys.has("level") || keys.has("xp")) return "Experience Points";
  if ([...keys].some((key) => /^(str|dex|wil)/.test(key))) return "Ability Scores";
  if ([...keys].some((key) => /^armor/.test(key))) return "Armor";
  if (keys.has("gp") || keys.has("sp") || keys.has("cp")) return "Wealth & Treasure";
  if (keys.has("fatigue") || keys.has("deprived")) return "Deprivation & Fatigue";
  if (keys.has("abilities")) return "About Talents";
  return section.label;
}

/** Fields whose rule is narrower than their section's, so they carry their own reminder. */
function rulesQueryForField(field: CharacterSheetDefinition["sections"][number]["fields"][number]) {
  if (field.key === "level") return "Leveling Up";
  if (field.key === "xp") return "Experience Points";
  // The CORRUPTION heading is only a divider; GAINING CORRUPTION carries the rule text.
  if (field.key === "corruption") return "Gaining Corruption";
  return undefined;
}

/** A section drops its own reminder once every field carries one. */
function hasFieldRules(section: CharacterSheetDefinition["sections"][number]) {
  return section.fields.length > 0 && section.fields.every((field) => rulesQueryForField(field) !== undefined);
}

function rulesQueryForList(list: CharacterSheetDefinition["lists"][number]) {
  // Monolith calls the carried-gear rule INVENTORY and the augmentation rule BODY SOCKETS.
  if (list.key === "augmentations") return "Body Sockets";
  if (list.key === "equipment" || list.key === "inventory") return "Inventory";
  return list.label;
}

function isWideSection(section: CharacterSheetDefinition["sections"][number]) {
  return section.fields.some(
    (field) => field.kind === "textarea" || field.kind === "entries" || field.kind === "vices"
  );
}

function fieldWidthClass(kind: CharacterSheetDefinition["sections"][number]["fields"][number]["kind"]) {
  if (kind === "textarea") return "wide-field";
  if (kind === "number" || kind === "checkbox") return "narrow-field";
  return "";
}

function pairedStatRows(section: CharacterSheetDefinition["sections"][number]) {
  return section.fields.flatMap((currentField) => {
    if (!currentField.key.endsWith("Current")) return [];
    const statKey = currentField.key.slice(0, -"Current".length);
    const maximumField = section.fields.find((field) => field.key === `${statKey}Max`);
    if (!maximumField) return [];
    return [
      {
        label: currentField.label.replace(/\s+current$/i, ""),
        currentField,
        maximumField
      }
    ];
  });
}

export function CharacterModal({
  roomId,
  system,
  role,
  accountId,
  revision,
  initialCharacterId,
  onRollSave,
  onClose
}: {
  roomId: number;
  system: SystemId;
  role: "gm" | "player";
  accountId: number;
  revision: number;
  initialCharacterId?: number;
  onRollSave: (setup: SaveRollSetup) => void;
  onClose: () => void;
}) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [definition, setDefinition] = useState<CharacterSheetDefinition>();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [partyLabel, setPartyLabel] = useState("Party");
  const [showAllCharacters, setShowAllCharacters] = useState(false);
  const [selectedId, setSelectedId] = useState<number>();
  const [name, setName] = useState("");
  const [sheet, setSheet] = useState<Record<string, unknown>>({});
  const [draftCharacterIds, setDraftCharacterIds] = useState<number[]>([]);
  const [pendingNameFocusId, setPendingNameFocusId] = useState<number>();
  /** Entry rows currently expanded for editing, as `${fieldKey}:${index}`. */
  const [openEntries, setOpenEntries] = useState<ReadonlySet<string>>(new Set());
  const [slotDialogKey, setSlotDialogKey] = useState<string>();
  const [itemCatalogue, setItemCatalogue] = useState<Record<string, CharacterItem[]>>({});
  const [viceCatalogue, setViceCatalogue] = useState<CharacterVice[]>([]);
  const [editingSlot, setEditingSlot] = useState<{ listKey: string; index: number }>();
  /**
   * The room pane's entrance animation forms a stacking context for its duration,
   * which would trap this fixed scrim beneath the rail. Rendering into the themed
   * workspace sidesteps it even while that animation is still running.
   */
  const [portalHost] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : (document.querySelector<HTMLElement>("main.workspace") ?? document.body)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rulesMarkdown, setRulesMarkdown] = useState("");
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesError, setRulesError] = useState("");
  const [activeRule, setActiveRule] = useState<ActiveRule>();
  const [editingMaximumSectionId, setEditingMaximumSectionId] = useState<string>();
  const activeRuleRef = useRef<HTMLDivElement>(null);
  const firstMaximumInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const autosaveTimerRef = useRef<number | undefined>(undefined);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSaveCountRef = useRef(0);
  const unsavedChangesRef = useRef(false);
  const editVersionRef = useRef(0);
  const selectedIdRef = useRef<number | undefined>(undefined);

  const selected = characters.find((character) => character.id === selectedId);
  const canEdit = selected && (role === "gm" || selected.ownerAccountId === accountId);
  const canMakeActive = Boolean(selected && selected.ownerAccountId === accountId && selected.id !== activeId);
  const canClaim = Boolean(selected && selected.ownerAccountId === null && role === "player");
  const canMoveToPool = Boolean(selected && role === "gm" && selected.ownerAccountId !== null);
  const hasChanges = Boolean(
    selected && canEdit && (name !== selected.name || JSON.stringify(sheet) !== JSON.stringify(selected.sheet))
  );
  unsavedChangesRef.current = hasChanges;
  selectedIdRef.current = selectedId;

  async function load(preferredId?: number) {
    const result = await api<CharacterResponse>(`/api/rooms/${roomId}/characters`);
    setCharacters(result.characters);
    setDefinition(result.sheetDefinition);
    setActiveId(result.activeCharacterId);
    setPartyLabel(result.partyLabel);
    setItemCatalogue(result.itemCatalogue);
    setViceCatalogue(result.viceCatalogue);
    setSelectedId((current) => {
      const desired = preferredId ?? current ?? result.activeCharacterId ?? undefined;
      return result.characters.some((character) => character.id === desired) ? desired : result.characters[0]?.id;
    });
  }

  useEffect(() => {
    load(initialCharacterId).catch((cause: Error) => setError(cause.message));
  }, [roomId, initialCharacterId]);

  useEffect(() => {
    if (revision === 0 || unsavedChangesRef.current || pendingSaveCountRef.current > 0) return;
    load().catch((cause: Error) => setError(cause.message));
  }, [revision]);

  useEffect(() => {
    let current = true;
    setRulesLoading(true);
    setRulesError("");
    api<string>(`/api/rooms/${roomId}/rules`)
      .then((markdown) => current && setRulesMarkdown(markdown))
      .catch((cause: Error) => current && setRulesError(cause.message))
      .finally(() => current && setRulesLoading(false));
    return () => {
      current = false;
    };
  }, [roomId]);

  useEffect(() => {
    if (!selected) {
      setName("");
      setSheet({});
      return;
    }
    setActiveRule(undefined);
    setName(selected.name);
    setSheet(structuredClone(selected.sheet));
    editVersionRef.current = 0;
  }, [selectedId, selected?.updatedAt]);

  useEffect(() => {
    setEditingMaximumSectionId(undefined);
    setOpenEntries(new Set());
    setSlotDialogKey(undefined);
    setEditingSlot(undefined);
  }, [roomId, selectedId]);

  useEffect(() => {
    if (editingMaximumSectionId) firstMaximumInputRef.current?.select();
  }, [editingMaximumSectionId]);

  useEffect(() => {
    // Waits for the sheet to adopt the new character, or the re-render collapses the selection.
    if (pendingNameFocusId === undefined || selectedId !== pendingNameFocusId) return;
    if (name !== newCharacterName) return;
    nameInputRef.current?.select();
    setPendingNameFocusId(undefined);
  }, [pendingNameFocusId, selectedId, name]);

  useEffect(() => {
    window.clearTimeout(autosaveTimerRef.current);
    if (!selected || !canEdit || !hasChanges || !name.trim()) return;
    const version = editVersionRef.current;
    autosaveTimerRef.current = window.setTimeout(() => {
      void persistSnapshot(selected, name, sheet, version);
    }, 500);
    return () => window.clearTimeout(autosaveTimerRef.current);
  }, [selectedId, name, sheet, hasChanges]);

  useEffect(
    () => () => {
      window.clearTimeout(autosaveTimerRef.current);
    },
    []
  );

  useEffect(() => {
    if (!activeRule) return;
    const dismiss = (event: PointerEvent) => {
      if (activeRuleRef.current && !activeRuleRef.current.contains(event.target as Node)) setActiveRule(undefined);
    };
    const dismissWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveRule(undefined);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismissWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismissWithKeyboard);
    };
  }, [activeRule?.id, activeRule?.pinned]);

  async function createCharacter() {
    if (busy || !(await persistCurrent())) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ character: Character }>(`/api/rooms/${roomId}/characters`, {
        method: "POST",
        body: JSON.stringify({ name: newCharacterName })
      });
      setDraftCharacterIds((current) => [...current, result.character.id]);
      await load(result.character.id);
      // The name is a placeholder, so hand the caret straight to it.
      setPendingNameFocusId(result.character.id);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function perform(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) {
    if (!selected) return;
    if (method === "DELETE") {
      window.clearTimeout(autosaveTimerRef.current);
      await saveChainRef.current;
    } else if (!(await persistCurrent())) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
      if (method === "DELETE") {
        setDraftCharacterIds((current) => current.filter((id) => id !== selected.id));
      }
      await load(method === "DELETE" ? undefined : selected.id);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function setField(key: string, value: unknown) {
    editVersionRef.current += 1;
    setError("");
    setSheet((current) => ({ ...current, [key]: value }));
  }

  function setFields(updates: Record<string, unknown>) {
    if (Object.keys(updates).length === 0) return;
    editVersionRef.current += 1;
    setError("");
    setSheet((current) => ({ ...current, ...updates }));
  }

  function toggleMaximumEditing(section: CharacterSheetDefinition["sections"][number], editing: boolean) {
    if (editing) {
      setEditingMaximumSectionId(section.id);
      return;
    }
    setEditingMaximumSectionId(undefined);
    setFields(
      currentsToBackfill(
        sheet,
        pairedStatRows(section).map(({ currentField, maximumField }) => ({
          currentKey: currentField.key,
          maximumKey: maximumField.key
        }))
      )
    );
  }

  function openEntry(fieldKey: string, index: number) {
    setOpenEntries((current) => new Set(current).add(entryHandle(fieldKey, index)));
  }

  function closeEntry(fieldKey: string, index: number) {
    setOpenEntries((current) => {
      const next = new Set(current);
      next.delete(entryHandle(fieldKey, index));
      return next;
    });
  }

  /** Rows shift down when one is removed, so the open set has to shift with them. */
  function forgetEntry(fieldKey: string, index: number) {
    setOpenEntries((current) => {
      const next = new Set<string>();
      for (const handle of current) {
        const position = entryHandlePosition(handle, fieldKey);
        if (position === undefined) next.add(handle);
        else if (position < index) next.add(handle);
        else if (position > index) next.add(entryHandle(fieldKey, position - 1));
      }
      return next;
    });
  }

  function addEntry(field: CharacterSheetDefinition["sections"][number]["fields"][number]) {
    const entries = readEntries(sheet[field.key]);
    setField(field.key, appendEntry(entries));
    openEntry(field.key, entries.length);
  }

  function readVices(value: unknown): CharacterVice[] {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (vice): vice is CharacterVice =>
        Boolean(vice) && typeof vice === "object" && typeof (vice as CharacterVice).name === "string"
    );
  }

  function setVice(fieldKey: string, index: number, vice: CharacterVice) {
    const vices = readVices(sheet[fieldKey]);
    setField(
      fieldKey,
      vices.map((current, position) => (position === index ? vice : current))
    );
  }

  function rollVice(fieldKey: string, index: number) {
    const vice = viceCatalogue[Math.floor(Math.random() * viceCatalogue.length)];
    if (vice) setVice(fieldKey, index, vice);
  }

  function renderVicesField(field: CharacterSheetDefinition["sections"][number]["fields"][number]) {
    const vices = readVices(sheet[field.key]);
    return (
      <div className="character-vices wide-field" role="group" aria-label={field.label} key={field.key}>
        {vices.map((vice, index) => (
          <article className="character-vice" key={index}>
            {canEdit && !vice.name && !vice.custom && (
              <div className="character-vice-picker">
                <select
                  aria-label={`Vice ${index + 1}`}
                  value={viceCatalogue.some((option) => option.name === vice.name) ? vice.name : ""}
                  onChange={(event) => {
                    if (event.target.value === "__custom__") {
                      setVice(field.key, index, { ...vice, custom: true });
                    } else {
                      const selectedVice = viceCatalogue.find((option) => option.name === event.target.value);
                      if (selectedVice) setVice(field.key, index, selectedVice);
                    }
                  }}
                >
                  <option value="" disabled>
                    Select a vice…
                  </option>
                  {viceCatalogue.map((option) => (
                    <option value={option.name} key={option.name}>
                      {option.name}
                    </option>
                  ))}
                  <option value="__custom__">Custom</option>
                </select>
                <button
                  type="button"
                  className="character-vice-roll"
                  aria-label={`Roll vice ${index + 1}`}
                  title="Roll on the vice table"
                  disabled={viceCatalogue.length === 0}
                  onClick={() => rollVice(field.key, index)}
                >
                  <Dices aria-hidden="true" />
                </button>
              </div>
            )}
            <div className="character-vice-heading">
              {vice.custom ? (
                <input
                  value={vice.name}
                  onChange={(event) => setVice(field.key, index, { ...vice, name: event.target.value })}
                  placeholder="Vice name"
                  aria-label={`Vice ${index + 1} name`}
                />
              ) : (
                <strong>{vice.name || "Choose a vice"}</strong>
              )}
              {canEdit && vice.name && !vice.custom && (
                <button
                  type="button"
                  className="character-entry-edit"
                  onClick={() => setVice(field.key, index, { ...vice, custom: true })}
                  aria-label={`Edit ${vice.name}`}
                >
                  <Pencil aria-hidden="true" />
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  className="character-entry-remove"
                  onClick={() =>
                    setField(
                      field.key,
                      vices.filter((_, position) => position !== index)
                    )
                  }
                  aria-label={`Remove ${vice.name || "vice"}`}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              )}
            </div>
            {(vice.name || vice.custom) && (
              <dl>
                <div>
                  <dt>Triggers</dt>
                  <dd>
                    {vice.custom ? (
                      <textarea
                        value={vice.triggers}
                        onChange={(event) => setVice(field.key, index, { ...vice, triggers: event.target.value })}
                        aria-label={`${vice.name || "Vice"} triggers`}
                      />
                    ) : (
                      vice.triggers
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Satisfying</dt>
                  <dd>
                    {vice.custom ? (
                      <textarea
                        value={vice.satisfying}
                        onChange={(event) => setVice(field.key, index, { ...vice, satisfying: event.target.value })}
                        aria-label={`${vice.name || "Vice"} satisfying`}
                      />
                    ) : (
                      vice.satisfying
                    )}
                  </dd>
                </div>
              </dl>
            )}
          </article>
        ))}
        {vices.length === 0 && (
          <p className="character-entries-empty">{canEdit ? "No vices yet." : "None recorded."}</p>
        )}
      </div>
    );
  }

  function setListItem(key: string, index: number, value: string) {
    const current = Array.isArray(sheet[key]) ? [...(sheet[key] as unknown[])] : [];
    current[index] = value;
    setField(key, current);
  }

  function changeName(value: string) {
    editVersionRef.current += 1;
    setError("");
    setName(value);
  }

  function persistSnapshot(
    character: Character,
    nextName: string,
    nextSheet: Record<string, unknown>,
    version: number
  ) {
    pendingSaveCountRef.current += 1;
    const operation = saveChainRef.current.then(async () => {
      try {
        const result = await api<{ character: Character }>(`/api/rooms/${roomId}/characters/${character.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: nextName, sheet: nextSheet })
        });
        if (selectedIdRef.current === character.id && editVersionRef.current === version) {
          setCharacters((current) =>
            current.map((item) => (item.id === result.character.id ? result.character : item))
          );
        }
        return true;
      } catch (cause) {
        setError((cause as Error).message);
        return false;
      } finally {
        pendingSaveCountRef.current -= 1;
      }
    });
    saveChainRef.current = operation.then(() => undefined);
    return operation;
  }

  async function persistCurrent() {
    window.clearTimeout(autosaveTimerRef.current);
    if (!selected || !canEdit) {
      await saveChainRef.current;
      return true;
    }
    if (!name.trim()) {
      setError("Character name is required.");
      return false;
    }
    if (!hasChanges) {
      await saveChainRef.current;
      return true;
    }
    return persistSnapshot(selected, name, sheet, editVersionRef.current);
  }

  async function selectCharacter(characterId: number) {
    if (characterId === selectedId || !(await persistCurrent())) return;
    setSelectedId(characterId);
  }

  async function keepAndClose() {
    if (busy || !(await persistCurrent())) return;
    onClose();
  }

  async function openSaveRoll(setup: SaveRollSetup) {
    if (busy || !(await persistCurrent())) return;
    onRollSave(setup);
  }

  async function uploadPortrait(file?: File) {
    if (!file || !selected || !canEdit) return;
    if (file.size > portraitUploadLimitBytes) {
      setError("Character portraits may be at most 5 MB.");
      return;
    }
    if (!portraitTypes.has(file.type)) {
      setError("Choose a PNG, JPEG, or WebP portrait.");
      return;
    }
    if (!(await persistCurrent())) return;
    const characterId = selected.id;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const result = await api<{ character: Character }>(`/api/rooms/${roomId}/characters/${characterId}/portrait`, {
        method: "POST",
        body
      });
      setCharacters((current) =>
        current.map((character) => (character.id === result.character.id ? result.character : character))
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removePortrait() {
    if (!selected || !canEdit || !selected.portraitUrl || !(await persistCurrent())) return;
    const characterId = selected.id;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ character: Character }>(`/api/rooms/${roomId}/characters/${characterId}/portrait`, {
        method: "DELETE"
      });
      setCharacters((current) =>
        current.map((character) => (character.id === result.character.id ? result.character : character))
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function requestClose() {
    if (busy) return;
    if (draftCharacterIds.length === 0) {
      await keepAndClose();
      return;
    }

    const draftName =
      draftCharacterIds.length === 1
        ? characters.find((character) => character.id === draftCharacterIds[0])?.name
        : undefined;
    const message =
      draftCharacterIds.length === 1
        ? `Discard ${draftName ?? "this new character"}? The character will be deleted.`
        : `Discard ${draftCharacterIds.length} new characters? They will be deleted.`;
    if (!window.confirm(message)) return;

    window.clearTimeout(autosaveTimerRef.current);
    await saveChainRef.current;
    setBusy(true);
    setError("");
    const remainingDraftIds: number[] = [];
    let discardError = "";
    for (const characterId of draftCharacterIds) {
      try {
        await api(`/api/rooms/${roomId}/characters/${characterId}`, { method: "DELETE" });
      } catch (cause) {
        remainingDraftIds.push(characterId);
        discardError ||= (cause as Error).message;
      }
    }
    setDraftCharacterIds(remainingDraftIds);
    setBusy(false);
    if (remainingDraftIds.length > 0) {
      setError(discardError || "The new character could not be discarded.");
      await load().catch(() => undefined);
      return;
    }
    onClose();
  }

  // A player at the table sees their own character first; a GM keeps the full roster.
  const grouped = role === "player" && activeId !== null;
  const roster = groupRoster(characters, accountId, activeId);
  // Collapsing must never hide the sheet the reader is looking at.
  const visibleElsewhere = showAllCharacters
    ? roster.elsewhere
    : roster.elsewhere.filter((character) => character.id === selectedId);
  const activeRuleExcerpt = activeRule ? findRuleExcerpt(rulesMarkdown, activeRule.query) : "";
  const activeRuleAnchorId = activeRule ? findRuleAnchorId(rulesMarkdown, activeRule.query) : "";
  const sections = definition?.sections ?? [];
  const statSections = sections.filter((section) => !isWideSection(section) && section.layout === "paired-current-max");
  const compactSections = sections.filter(
    (section) => !isWideSection(section) && section.layout !== "paired-current-max"
  );
  const wideSections = sections.filter(isWideSection);

  function renderEntriesField(field: CharacterSheetDefinition["sections"][number]["fields"][number]) {
    const entries = readEntries(sheet[field.key]);
    const singular = singularLabel(field.label);
    const setEntries = (next: CharacterEntry[]) => setField(field.key, next);

    return (
      <div className="character-entries wide-field" role="group" aria-label={field.label} key={field.key}>
        {entries.map((entry, index) => {
          const name = entryName(entry, index, singular);
          const editing = canEdit && openEntries.has(entryHandle(field.key, index));
          if (!editing) {
            return (
              <article className="character-entry character-entry-locked" key={index}>
                <strong>{name}</strong>
                {canEdit && (
                  <button
                    type="button"
                    className="character-entry-edit"
                    onClick={() => openEntry(field.key, index)}
                    aria-label={`Edit ${name}`}
                    title={`Edit ${singular.toLocaleLowerCase()}`}
                  >
                    <Pencil aria-hidden="true" />
                  </button>
                )}
                {entry.text.trim() && <p>{entry.text}</p>}
              </article>
            );
          }
          return (
            <article className="character-entry" key={index}>
              <input
                className="character-entry-title"
                value={entry.title}
                onChange={(event) => setEntries(updateEntry(entries, index, { title: event.target.value }))}
                placeholder={`${singular} name`}
                aria-label={`${singular} ${index + 1} name`}
              />
              <div className="character-entry-actions">
                <button
                  type="button"
                  className="character-entry-confirm"
                  onClick={() => closeEntry(field.key, index)}
                  aria-label={`Save ${name}`}
                  title="Done"
                >
                  <Check aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="character-entry-remove"
                  onClick={() => {
                    setEntries(removeEntry(entries, index));
                    forgetEntry(field.key, index);
                  }}
                  aria-label={`Remove ${name}`}
                  title="Remove"
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
              <textarea
                value={entry.text}
                onChange={(event) => setEntries(updateEntry(entries, index, { text: event.target.value }))}
                placeholder="What it does"
                aria-label={`${name} rules text`}
              />
            </article>
          );
        })}
        {entries.length === 0 && (
          <p className="character-entries-empty">
            {canEdit ? `No ${field.label.toLocaleLowerCase()} yet.` : "None recorded."}
          </p>
        )}
      </div>
    );
  }

  /** The book icon and its popover, shared by rule-backed sections and slot lists. */
  function renderRuleHelp(id: string, query: string) {
    const tooltipId = `character-rule-${id}`;
    const isActive = activeRule?.id === id;
    return (
      <div
        className="character-rule-help"
        key={id}
        ref={isActive ? activeRuleRef : undefined}
        onMouseEnter={() => setActiveRule((current) => (current?.pinned ? current : { id, query, pinned: false }))}
        onMouseLeave={() => setActiveRule((current) => (current?.id === id && !current.pinned ? undefined : current))}
        onFocus={() => setActiveRule((current) => (current?.pinned ? current : { id, query, pinned: false }))}
        onBlur={(event) => {
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
          setActiveRule((current) => (current?.id === id && !current.pinned ? undefined : current));
        }}
      >
        <button
          type="button"
          aria-label={`Show ${query} rules`}
          aria-expanded={isActive}
          aria-controls={isActive ? tooltipId : undefined}
          onClick={() => setActiveRule({ id, query, pinned: true })}
        >
          <BookOpen />
        </button>
        {isActive && (
          <div
            className={`character-rule-popover${activeRule.pinned ? " pinned" : ""}`}
            id={tooltipId}
            role={activeRule.pinned ? "dialog" : "tooltip"}
            aria-label={activeRule.pinned ? `${query} rules` : undefined}
            aria-live="polite"
          >
            <header>
              {activeRule.pinned && activeRuleAnchorId ? (
                <a
                  className="character-rule-jump"
                  href={rulesAnchorPath(system, roomId, activeRuleAnchorId)}
                  target="_blank"
                  rel="noreferrer"
                  title={`Open ${query} in the full ${system} rules`}
                >
                  {query}
                  <ArrowUpRight aria-hidden="true" />
                </a>
              ) : (
                <strong>{query}</strong>
              )}
              <span>{activeRule.pinned ? "Pinned · click outside to close" : "Click to keep open"}</span>
            </header>
            <div className="character-rule-content markdown">
              {rulesLoading ? (
                <p>Loading rules…</p>
              ) : rulesError ? (
                <p className="form-error">Rules unavailable: {rulesError}</p>
              ) : activeRuleExcerpt ? (
                <RulesMarkdown markdown={activeRuleExcerpt} idPrefix={tooltipId} />
              ) : (
                <p>No matching rule section.</p>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderSection(section: CharacterSheetDefinition["sections"][number]) {
    const editingMaxima = editingMaximumSectionId === section.id;
    const entriesField = section.fields.find((field) => field.kind === "entries" || field.kind === "vices");
    return (
      <fieldset className="character-rule-fieldset" key={section.id}>
        <legend>
          <span className="character-legend-title">
            <span>{section.label}</span>
            {entriesField && canEdit && (
              <button
                type="button"
                className="character-legend-add"
                onClick={() =>
                  entriesField.kind === "vices"
                    ? setField(entriesField.key, [
                        ...readVices(sheet[entriesField.key]),
                        { name: "", triggers: "", satisfying: "" }
                      ])
                    : addEntry(entriesField)
                }
                aria-label={`Add ${singularLabel(entriesField.label).toLocaleLowerCase()}`}
                title={`Add ${singularLabel(entriesField.label).toLocaleLowerCase()}`}
              >
                <Plus aria-hidden="true" />
              </button>
            )}
          </span>
          {!hasFieldRules(section) && renderRuleHelp(section.id, rulesQueryForSection(section))}
        </legend>
        {section.layout === "paired-current-max" ? (
          <div className="character-stat-table">
            <div className="character-stat-header">
              <span aria-hidden="true" />
              <span aria-hidden="true">Current</span>
              <span className="character-stat-max-header">
                <span aria-hidden="true">Max</span>
                {canEdit && (
                  <button
                    type="button"
                    className="character-stat-max-toggle"
                    aria-pressed={editingMaxima}
                    aria-label={
                      editingMaxima ? `Finish editing ${section.label} maximums` : `Edit ${section.label} maximums`
                    }
                    title={editingMaxima ? "Done editing maximums" : "Edit maximums"}
                    onClick={() => toggleMaximumEditing(section, !editingMaxima)}
                  >
                    {editingMaxima ? <Check aria-hidden="true" /> : <Pencil aria-hidden="true" />}
                  </button>
                )}
              </span>
            </div>
            {pairedStatRows(section).map(({ label, currentField, maximumField }, rowIndex) => {
              const saveSetup = saveSetupForField(currentField, sheet[currentField.key]);
              return (
                <div className="character-stat-row" role="group" aria-label={label} key={currentField.key}>
                  <span className="character-stat-name">
                    <span>{label}</span>
                    {currentField.roll && (
                      <button
                        type="button"
                        className="character-stat-roll"
                        aria-label={
                          saveSetup
                            ? `Roll ${saveSetup.label} save at target ${saveSetup.target}`
                            : `Roll ${currentField.roll.label} save`
                        }
                        title={
                          saveSetup
                            ? `Roll ${saveSetup.label} save (target ${saveSetup.target})`
                            : `Enter a target from 1 to 20 to roll a ${currentField.roll.label} save`
                        }
                        disabled={!saveSetup || busy}
                        onClick={() => saveSetup && void openSaveRoll(saveSetup)}
                      >
                        <Dices aria-hidden="true" />
                      </button>
                    )}
                  </span>
                  <div className="character-stat-values">
                    <input
                      type="number"
                      aria-label={`${label} current`}
                      value={String(sheet[currentField.key] ?? "")}
                      onChange={(event) =>
                        setField(currentField.key, event.target.value === "" ? "" : Number(event.target.value))
                      }
                      disabled={!canEdit}
                    />
                    <input
                      type="number"
                      className="character-stat-max"
                      aria-label={`${label} maximum`}
                      value={String(sheet[maximumField.key] ?? "")}
                      onChange={(event) =>
                        setField(maximumField.key, event.target.value === "" ? "" : Number(event.target.value))
                      }
                      disabled={!canEdit}
                      readOnly={!editingMaxima}
                      ref={editingMaxima && rowIndex === 0 ? firstMaximumInputRef : undefined}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="character-sheet-fields">
            {section.fields.map((field) => {
              if (field.kind === "entries") return renderEntriesField(field);
              if (field.kind === "vices") return renderVicesField(field);
              const fieldId = `character-field-${section.id}-${field.key}`;
              const fieldQuery = rulesQueryForField(field);
              return (
                <div className={`character-sheet-field ${fieldWidthClass(field.kind)}`} key={field.key}>
                  <span className="character-field-label">
                    <label htmlFor={fieldId}>{field.label}</label>
                    {field.roll && (
                      <button
                        type="button"
                        className="character-stat-roll"
                        aria-label={`Roll ${field.roll.label} save`}
                        title={`Roll ${field.roll.label} save`}
                        disabled={!saveSetupForField(field, sheet[field.key]) || busy}
                        onClick={() => {
                          const setup = saveSetupForField(field, sheet[field.key]);
                          if (setup) void openSaveRoll(setup);
                        }}
                      >
                        <Dices aria-hidden="true" />
                      </button>
                    )}
                    {fieldQuery && renderRuleHelp(`field-${field.key}`, fieldQuery)}
                  </span>
                  {field.kind === "checkbox" ? (
                    <input
                      id={fieldId}
                      type="checkbox"
                      checked={sheet[field.key] === true}
                      onChange={(event) => setField(field.key, event.target.checked)}
                      disabled={!canEdit}
                    />
                  ) : field.kind === "textarea" ? (
                    <textarea
                      id={fieldId}
                      value={String(sheet[field.key] ?? "")}
                      onChange={(event) => setField(field.key, event.target.value)}
                      disabled={!canEdit}
                    />
                  ) : (
                    <input
                      id={fieldId}
                      type={field.kind}
                      value={String(sheet[field.key] ?? "")}
                      onChange={(event) =>
                        setField(
                          field.key,
                          field.kind === "number" && event.target.value !== ""
                            ? Number(event.target.value)
                            : event.target.value
                        )
                      }
                      placeholder={field.placeholder}
                      disabled={!canEdit}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </fieldset>
    );
  }

  function renderIndexRow(character: Character) {
    return (
      <button
        type="button"
        className={character.id === selectedId ? "selected" : ""}
        key={character.id}
        onClick={() => void selectCharacter(character.id)}
      >
        <span>
          {character.name} <em>({character.ownerUsername ?? "unclaimed"})</em>
        </span>
        {character.id === activeId && <small>Active</small>}
      </button>
    );
  }

  function slotValue(list: CharacterSheetDefinition["lists"][number], index: number) {
    const stored = Array.isArray(sheet[list.key]) ? (sheet[list.key] as unknown[])[index] : "";
    return String(stored ?? "");
  }

  function renderSlotInput(list: CharacterSheetDefinition["lists"][number], slot: string, index: number) {
    const stock = characterItemsForSlot(itemCatalogue[list.key] ?? [], list, index);
    return (
      <div
        className={`character-slot ${index > 0 && list.groupStarts?.includes(index) ? "character-list-group-start" : ""}`}
        key={`${list.key}-${slot}`}
      >
        <label>
          <span>{slot}</span>
          <input
            value={slotValue(list, index)}
            onChange={(event) => setListItem(list.key, index, event.target.value)}
            disabled={!canEdit}
          />
        </label>
        {canEdit && stock.length > 0 && (
          <button
            type="button"
            className="character-slot-edit"
            aria-label={`Choose an item for ${slot}`}
            title="Choose an item"
            onClick={() => setEditingSlot({ listKey: list.key, index })}
          >
            <Pencil size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    );
  }

  function renderSlotEditor(list: CharacterSheetDefinition["lists"][number]) {
    if (editingSlot?.listKey !== list.key) return null;
    const stock = characterItemsForSlot(itemCatalogue[list.key] ?? [], list, editingSlot.index);
    return (
      <CharacterItemEditor
        // Keyed by slot so picking a second pencil starts that slot's editor
        // fresh instead of carrying the first slot's typed value across.
        key={`${list.key}-${editingSlot.index}`}
        slotName={list.slots[editingSlot.index] ?? `Slot ${editingSlot.index + 1}`}
        items={stock}
        current={slotValue(list, editingSlot.index)}
        onCancel={() => setEditingSlot(undefined)}
        onSubmit={(value) => {
          setListItem(list.key, editingSlot.index, value);
          setEditingSlot(undefined);
        }}
      />
    );
  }

  function renderList(list: CharacterSheetDefinition["lists"][number]) {
    const filled = list.slots.flatMap((slot, index) => (slotValue(list, index).trim() ? [{ slot, index }] : []));
    return (
      <fieldset className="character-rule-fieldset" key={list.key}>
        <legend>
          <span className="character-legend-title">
            <span>{list.label}</span>
            {list.editInDialog && canEdit && (
              <button
                type="button"
                className="character-legend-add"
                onClick={() => setSlotDialogKey(list.key)}
                aria-label={`Edit ${list.label.toLocaleLowerCase()}`}
                title={`Edit ${list.label.toLocaleLowerCase()}`}
              >
                <Pencil aria-hidden="true" />
              </button>
            )}
          </span>
          {renderRuleHelp(`list-${list.key}`, rulesQueryForList(list))}
        </legend>
        {list.editInDialog ? (
          filled.length > 0 ? (
            <ul className="character-slot-summary">
              {filled.map(({ slot, index }) => (
                <li key={`${list.key}-${slot}`}>
                  <span>{slot}</span>
                  <strong>{slotValue(list, index)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="character-entries-empty">
              {canEdit ? `No ${list.label.toLocaleLowerCase()} filled.` : "None recorded."}
            </p>
          )
        ) : (
          <>
            <div className="character-list">{list.slots.map((slot, index) => renderSlotInput(list, slot, index))}</div>
            {renderSlotEditor(list)}
          </>
        )}
      </fieldset>
    );
  }

  function renderSlotDialog() {
    const list = definition?.lists.find((candidate) => candidate.key === slotDialogKey);
    if (!list) return null;
    return (
      <div
        className="modal-scrim character-slot-scrim"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSlotDialogKey(undefined);
        }}
      >
        <section className="modal character-slot-modal" role="dialog" aria-modal="true" aria-label={list.label}>
          <header>
            <p className="eyebrow">{selected?.name}</p>
            <h2>{list.label}</h2>
            <button type="button" onClick={() => setSlotDialogKey(undefined)} aria-label="Close">
              <X />
            </button>
          </header>
          <div className="character-slot-body">
            <div className="character-list">{list.slots.map((slot, index) => renderSlotInput(list, slot, index))}</div>
            {renderSlotEditor(list)}
          </div>
          <footer>
            <button type="button" className="primary-button" onClick={() => setSlotDialogKey(undefined)}>
              Done
            </button>
          </footer>
        </section>
      </div>
    );
  }

  return createPortal(
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) void requestClose();
      }}
    >
      <section className="modal modal-wide character-modal" role="dialog" aria-modal="true" aria-label="Characters">
        <header>
          <p className="eyebrow">Persistent company</p>
          <h2>Characters</h2>
          <button onClick={() => void keepAndClose()} aria-label="Close" disabled={busy}>
            <X />
          </button>
        </header>
        {error && <p className="form-error character-error">{error}</p>}
        <div className="character-workspace">
          <aside className="character-index" aria-label="Available characters">
            {characters.length === 0 && <p>No compatible characters yet. Create one below to begin.</p>}
            {grouped ? (
              <>
                {roster.mine.map(renderIndexRow)}
                {roster.party.length > 0 && <p className="character-index-heading">{partyLabel}</p>}
                {roster.party.map(renderIndexRow)}
                {roster.elsewhere.length > 0 && (
                  <>
                    {showAllCharacters && <p className="character-index-heading">Other characters</p>}
                    {visibleElsewhere.map(renderIndexRow)}
                    <button
                      type="button"
                      className="character-index-toggle"
                      aria-expanded={showAllCharacters}
                      onClick={() => setShowAllCharacters((current) => !current)}
                    >
                      {showAllCharacters ? "Show fewer" : `Show all (${roster.elsewhere.length})`}
                    </button>
                  </>
                )}
              </>
            ) : (
              characters.map(renderIndexRow)
            )}
            <button
              type="button"
              className="character-index-create"
              onClick={() => void createCharacter()}
              disabled={busy}
            >
              <Plus size={15} aria-hidden="true" />
              <span>New character</span>
            </button>
          </aside>
          {selected && definition ? (
            <form className="character-sheet" onSubmit={(event) => event.preventDefault()}>
              <div className="character-profile">
                <div className={`character-portrait-frame${selected.portraitUrl ? " has-portrait" : ""}`}>
                  {selected.portraitUrl ? (
                    <img src={selected.portraitUrl} alt={`${selected.name} portrait`} />
                  ) : (
                    <UserRound aria-hidden="true" />
                  )}
                  {canEdit && (
                    <div className="character-portrait-actions">
                      <label title={selected.portraitUrl ? "Replace portrait" : "Upload portrait"}>
                        <ImagePlus aria-hidden="true" />
                        <span>{selected.portraitUrl ? "Replace" : "Upload"}</span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                          disabled={busy}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            void uploadPortrait(file);
                          }}
                        />
                      </label>
                      {selected.portraitUrl && (
                        <button
                          type="button"
                          onClick={() => void removePortrait()}
                          disabled={busy}
                          aria-label={`Remove ${selected.name} portrait`}
                          title="Remove portrait"
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="character-sheet-heading">
                  <label>
                    Character name
                    <input
                      ref={nameInputRef}
                      value={name}
                      onChange={(event) => changeName(event.target.value)}
                      disabled={!canEdit}
                    />
                  </label>
                  <p>
                    {selected.ownerUsername ? `Owned by ${selected.ownerUsername}` : "Unassigned room character"}
                    {selected.activeBy.length > 0 &&
                      ` · Active: ${selected.activeBy.map((item) => item.displayName).join(", ")}`}
                  </p>
                </div>
              </div>
              {(canMakeActive || canClaim) && (
                <div className="character-actions">
                  {canMakeActive && (
                    <button
                      type="button"
                      onClick={() =>
                        perform(`/api/rooms/${roomId}/active-character`, "PATCH", { characterId: selected.id })
                      }
                    >
                      <Check size={16} /> Make active
                    </button>
                  )}
                  {canClaim && (
                    <button
                      type="button"
                      onClick={() => perform(`/api/rooms/${roomId}/characters/${selected.id}/claim`, "POST")}
                    >
                      <Check size={16} /> Claim & activate
                    </button>
                  )}
                </div>
              )}
              {selected.warnings.length > 0 && (
                <section className="character-warnings" aria-label="Rules warnings">
                  <strong>Check the sheet</strong>
                  {selected.warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </section>
              )}
              {system === "monolith" ? (
                <>
                  <div className="character-layout character-layout-monolith">
                    <div className="character-layout-rail character-layout-left">
                      {sections.filter((section) => section.id === "identity").map(renderSection)}
                    </div>
                    <div className="character-layout-main">
                      {sections
                        .filter(
                          (section) => section.id !== "identity" && section.id !== "talents" && section.id !== "vices"
                        )
                        .map(renderSection)}
                    </div>
                    <div className="character-layout-talents">
                      {sections.filter((section) => section.id === "talents").map(renderSection)}
                    </div>
                    <div className="character-layout-rail character-layout-right">
                      {definition.lists.filter((list) => list.key === "equipment").map(renderList)}
                      {sections.filter((section) => section.id === "vices").map(renderSection)}
                    </div>
                  </div>
                  {definition.lists.filter((list) => list.key !== "equipment").map(renderList)}
                </>
              ) : (
                <>
                  {(statSections.length > 0 || compactSections.length > 0) && (
                    <div className="character-section-band">
                      {statSections.length > 0 && (
                        <div className="character-band-stats">{statSections.map(renderSection)}</div>
                      )}
                      {compactSections.length > 0 && (
                        <div className="character-band-compact">{compactSections.map(renderSection)}</div>
                      )}
                    </div>
                  )}
                  {wideSections.map(renderSection)}
                  {definition.lists.map(renderList)}
                </>
              )}
              {(canMoveToPool || canEdit) && (
                <div className="character-actions character-actions-footer">
                  {canMoveToPool && (
                    <button
                      type="button"
                      onClick={() => perform(`/api/rooms/${roomId}/characters/${selected.id}/unassign`, "POST")}
                    >
                      <UserMinus size={16} /> Move to pool
                    </button>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      className="character-delete"
                      onClick={() => {
                        if (window.confirm(`Delete ${selected.name}? This cannot be undone.`))
                          perform(`/api/rooms/${roomId}/characters/${selected.id}`, "DELETE");
                      }}
                    >
                      <Trash2 size={16} /> Delete character
                    </button>
                  )}
                </div>
              )}
            </form>
          ) : (
            <div className="character-empty">
              <p className="eyebrow">First join</p>
              <h3>Choose how you enter the story.</h3>
              <p>Create a new character, select one you already own, or claim an unassigned character from the room.</p>
            </div>
          )}
        </div>
      </section>
      {renderSlotDialog()}
    </div>,
    portalHost ?? document.body
  );
}
