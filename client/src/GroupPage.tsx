import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Pencil, Rocket, UsersRound } from "lucide-react";
import type {
  CharacterFieldDefinition,
  CharacterListDefinition,
  CharacterSheetDefinition,
  GroupPageDefinition,
  GroupSheetSection,
  SystemId
} from "@devils-toys/shared";
import { api } from "./api";
import { headingSlug, rulesAnchorPath } from "./rules";
import { applyStarshipSize, holdSlots, setHoldValue, starshipHolds, starshipSizeFor } from "./starship";
import { HoldEditor } from "./StarshipHoldEditor";
import "./GroupPage.css";

interface GroupResponse {
  state: Record<string, unknown>;
  definition: GroupPageDefinition;
  updatedAt: string | null;
}

type SaveStatus = "Saved" | "Unsaved" | "Saving…";

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

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

export function GroupPage({
  roomId,
  system,
  revision,
  hidden
}: {
  roomId: number;
  system: SystemId;
  revision: number;
  hidden: boolean;
}) {
  const [definition, setDefinition] = useState<GroupPageDefinition>();
  const [state, setState] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<SaveStatus>("Saved");
  const [error, setError] = useState("");
  const [editingHold, setEditingHold] = useState<{ index: number; value: string }>();
  const [holdError, setHoldError] = useState("");
  const saveTimerRef = useRef<number | undefined>(undefined);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const latestStateRef = useRef<Record<string, unknown>>({});
  const editVersionRef = useRef(0);
  const dirtyRef = useRef(false);

  async function load() {
    const response = await api<GroupResponse>(`/api/rooms/${roomId}/group`);
    setDefinition(response.definition);
    setState(response.state);
    latestStateRef.current = response.state;
    dirtyRef.current = false;
    setStatus("Saved");
    setError("");
  }

  useEffect(() => {
    void load().catch((cause: Error) => setError(cause.message));
    return () => {
      window.clearTimeout(saveTimerRef.current);
      if (dirtyRef.current) {
        void api(`/api/rooms/${roomId}/group`, {
          method: "PATCH",
          body: JSON.stringify({ state: latestStateRef.current })
        });
      }
    };
  }, [roomId]);

  useEffect(() => {
    if (revision > 0 && !dirtyRef.current) void load().catch((cause: Error) => setError(cause.message));
  }, [revision]);

  function queueSave(next: Record<string, unknown>) {
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
          await api(`/api/rooms/${roomId}/group`, {
            method: "PATCH",
            body: JSON.stringify({ state: next })
          });
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
    const next = updater(latestStateRef.current);
    latestStateRef.current = next;
    setState(next);
    queueSave(next);
  }

  function setGroupField(key: string, value: unknown) {
    updateState((current) => ({ ...current, [key]: value }));
  }

  function setStarshipField(key: string, value: unknown) {
    updateState((current) => ({ ...current, starship: { ...recordValue(current.starship), [key]: value } }));
  }

  function setStarshipListItem(key: string, index: number, value: string) {
    updateState((current) => {
      const starship = recordValue(current.starship);
      const list = Array.isArray(starship[key]) ? [...(starship[key] as unknown[])] : [];
      list[index] = value;
      return { ...current, starship: { ...starship, [key]: list } };
    });
  }

  /** Installs a part through the hold rules, reporting a refusal rather than forcing it. */
  function installHold(
    list: CharacterListDefinition,
    index: number,
    value: string,
    bulky: boolean,
    capacity: number | undefined
  ) {
    const holds = capacity ?? list.slots.length;
    const result = setHoldValue(holdSlots(recordValue(state.starship), list.key, holds), index, value, {
      bulky,
      capacity: holds,
      slotName: (position) => list.slots[position] ?? `Hold ${position + 1}`
    });
    if (!result.ok) return setHoldError(result.error);
    updateState((current) => ({
      ...current,
      starship: { ...recordValue(current.starship), [list.key]: result.slots }
    }));
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
            onChange={(event) => setField(field.key, event.target.checked)}
          />
        ) : field.kind === "textarea" ? (
          <textarea
            id={fieldId}
            value={String(values[field.key] ?? "")}
            placeholder={field.placeholder}
            onChange={(event) => setField(field.key, event.target.value)}
          />
        ) : (
          <>
            <input
              id={fieldId}
              type={field.kind}
              value={String(values[field.key] ?? "")}
              placeholder={field.placeholder}
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
    ship: Record<string, unknown>
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
          onChange={(event) =>
            updateState((current) => ({
              ...current,
              starship: applyStarshipSize(recordValue(current.starship), sheet, event.target.value)
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

  function renderStarshipSection(section: CharacterSheetDefinition["sections"][number], ship: Record<string, unknown>) {
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
                    onChange={(event) =>
                      setStarshipField(currentField.key, event.target.value === "" ? "" : Number(event.target.value))
                    }
                  />
                  <input
                    type="number"
                    aria-label={`${label} maximum`}
                    value={String(ship[maximumField.key] ?? "")}
                    onChange={(event) =>
                      setStarshipField(maximumField.key, event.target.value === "" ? "" : Number(event.target.value))
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
                : renderField(section, field, ship, setStarshipField)
            )}
          </div>
        )}
      </fieldset>
    );
  }

  if (!definition)
    return (
      <div className="group-page" hidden={hidden}>
        <p className={error ? "form-error" : "group-loading"}>{error || "Opening the group ledger…"}</p>
      </div>
    );

  const ship = recordValue(state.starship);
  const holdCapacity = starshipHolds(definition.starshipSheet, ship.size);
  const partsList = definition.starshipSheet?.partsList;

  return (
    <div className="group-page character-sheet" hidden={hidden}>
      <header className="group-page-header">
        <div>
          <p className="panel-kicker">Shared room record</p>
          <h2>Group</h2>
        </div>
        <span className={`group-save-status group-save-${status.replace("…", "").toLocaleLowerCase()}`}>{status}</span>
      </header>
      {error && <p className="form-error">{error}</p>}

      {definition.sections.map((section) => (
        <fieldset key={section.id}>
          <legend>{section.label}</legend>
          <div className="character-sheet-fields">
            {section.fields.map((field) => renderField(section, field, state, setGroupField, field.rulesQuery))}
          </div>
        </fieldset>
      ))}

      {definition.hirelings && (
        <section className="group-placeholder" aria-labelledby="group-hirelings-heading">
          <UsersRound aria-hidden="true" />
          <div>
            <h3 id="group-hirelings-heading">{definition.hirelings.label}</h3>
            <p>{definition.hirelings.placeholder}</p>
          </div>
          <span>Placeholder</span>
        </section>
      )}

      {definition.starshipSheet && (
        <section className="group-starship">
          <header className="group-starship-header">
            <div>
              <Rocket aria-hidden="true" />
              <div>
                <p className="panel-kicker">Shared asset</p>
                <h3>Starship</h3>
              </div>
            </div>
            {rulesLink("Starships", "Starship rules")}
          </header>
          {definition.starshipSheet.sections.map((section) => renderStarshipSection(section, ship))}
          {definition.starshipSheet.lists.map((list) => {
            const visibleSlots = holdCapacity ? list.slots.slice(0, holdCapacity) : list.slots;
            return (
              <fieldset key={list.key}>
                <legend>
                  <span>{list.label}</span>
                  <small>{holdCapacity ? `${holdCapacity} · ${ship.size}` : "Choose a size · showing max"}</small>
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
                            (Array.isArray(ship[list.key]) ? (ship[list.key] as unknown[])[index] : "") ?? ""
                          )}
                          onChange={(event) => setStarshipListItem(list.key, index, event.target.value)}
                        />
                      </label>
                      {list.key === partsList && (
                        <button
                          type="button"
                          className="starship-hold-edit"
                          aria-label={`Choose a part for ${slot}`}
                          title="Choose a part"
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
                      (Array.isArray(ship[list.key]) ? (ship[list.key] as unknown[])[editingHold.index] : "") ?? ""
                    )}
                    error={holdError}
                    onCancel={() => {
                      setEditingHold(undefined);
                      setHoldError("");
                    }}
                    onSubmit={(value, bulky) => installHold(list, editingHold.index, value, bulky, holdCapacity)}
                  />
                )}
              </fieldset>
            );
          })}
        </section>
      )}
    </div>
  );
}
