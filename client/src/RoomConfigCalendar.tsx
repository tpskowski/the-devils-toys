import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, RotateCcw, Save, Trash2, TriangleAlert } from "lucide-react";
import {
  CALENDAR_CADENCES,
  calendarEventDays,
  calendarEventIsCounted,
  calendarEventNever,
  calendarEventPeriod,
  calendarSegmentLabel,
  type CalendarEvent,
  type CalendarEventCadence,
  type RoomCalendar
} from "@devils-toys/shared";
import { ApiError, api } from "./api";

type NameList = "monthNames" | "dayNames" | "segmentNames";

function move<T>(items: T[], from: number, to: number) {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * What the calendar's own numbers say about the name lists beside them. A
 * calendar stays usable when they disagree — the week falls back to "Day 3" —
 * so these are warnings rather than a refusal to save.
 */
function shapeWarnings(calendar: RoomCalendar) {
  const warnings: string[] = [];
  if (calendar.dayNames.length !== calendar.daysPerWeek)
    warnings.push(
      `The week is ${calendar.daysPerWeek} days long but ${calendar.dayNames.length} ${
        calendar.dayNames.length === 1 ? "day is" : "days are"
      } named. Unnamed days show as “Day 3”.`
    );
  if (calendar.segmentNames.length && calendar.segmentNames.length !== calendar.segmentsPerDay)
    warnings.push(
      `A day has ${calendar.segmentsPerDay} ${calendar.segmentsPerDay === 1 ? "part" : "parts"} but ${
        calendar.segmentNames.length
      } are named. Unnamed parts are numbered.`
    );
  if (calendar.day > calendar.daysPerMonth)
    warnings.push(`Today is day ${calendar.day}, past the end of a ${calendar.daysPerMonth}-day month.`);
  if (calendar.month >= calendar.monthNames.length)
    warnings.push("The current month is past the end of the list of months.");
  return warnings;
}

/** What changed between the calendar in hand and the one the server now holds. */
function differences(mine: RoomCalendar, theirs: RoomCalendar) {
  const changed: string[] = [];
  const compare = (label: string, left: unknown, right: unknown) => {
    if (JSON.stringify(left) !== JSON.stringify(right)) changed.push(label);
  };
  compare(
    "the current date",
    [mine.year, mine.month, mine.day, mine.segment],
    [theirs.year, theirs.month, theirs.day, theirs.segment]
  );
  compare("the length of a week", mine.daysPerWeek, theirs.daysPerWeek);
  compare("the length of a month", mine.daysPerMonth, theirs.daysPerMonth);
  compare("the parts of a day", mine.segmentsPerDay, theirs.segmentsPerDay);
  compare("the names of months", mine.monthNames, theirs.monthNames);
  compare("the names of days", mine.dayNames, theirs.dayNames);
  compare("the names of a day’s parts", mine.segmentNames, theirs.segmentNames);
  compare("the events", mine.events, theirs.events);
  return changed;
}

export function RoomConfigCalendar({
  roomId,
  calendar: server,
  onSaved
}: {
  roomId: number;
  calendar: RoomCalendar;
  onSaved: (calendar: RoomCalendar) => void;
}) {
  const [draft, setDraft] = useState(server);
  // The calendar this draft was started from. A clash is judged against it, not
  // against what is being sent — otherwise the panel would report the editor's
  // own edits back to them as somebody else's changes.
  const [baseline, setBaseline] = useState(server);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  // Set when the server refuses a stale save. It holds the calendar as it now
  // stands and what about it moved, so the answer to a clash is a choice rather
  // than a lost afternoon of typing.
  const [clash, setClash] = useState<{ theirs: RoomCalendar; changed: string[] }>();

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline]);

  const startFrom = (calendar: RoomCalendar) => {
    setDraft(calendar);
    setBaseline(calendar);
  };

  // A change made at the table only replaces the draft when nothing is being
  // edited here; otherwise it waits, and a save turns it into a visible clash.
  useEffect(() => {
    if (!dirty) startFrom(server);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server]);

  const set = <K extends keyof RoomCalendar>(key: K, value: RoomCalendar[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const setNames = (key: NameList, names: string[]) => setDraft((current) => ({ ...current, [key]: names }));

  const warnings = shapeWarnings(draft);

  async function save(from: RoomCalendar = draft) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ calendar: RoomCalendar }>(`/api/rooms/${roomId}/calendar`, {
        method: "PUT",
        body: JSON.stringify(from)
      });
      startFrom(result.calendar);
      setClash(undefined);
      onSaved(result.calendar);
      setNotice("Calendar saved.");
    } catch (cause) {
      // 409 is the calendar's own answer to a stale save: someone else wrote
      // while this was being edited. Ask what it now holds and offer a choice.
      if (cause instanceof ApiError && cause.status === 409) {
        const latest = (await api<{ calendar: RoomCalendar }>(`/api/room-config/${roomId}`)).calendar;
        setClash({ theirs: latest, changed: differences(baseline, latest) });
      } else {
        setError((cause as Error).message);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rc-calendar">
      {error && <p className="room-config-error">{error}</p>}
      {notice && !dirty && <p className="rc-notice">{notice}</p>}

      {clash && (
        <div className="rc-clash">
          <h3>
            <TriangleAlert size={16} /> The calendar changed while you were editing
          </h3>
          <p>
            {clash.changed.length
              ? `Someone else changed ${clash.changed.join(", ")}.`
              : "Someone else saved the calendar."}{" "}
            Your edits are still here, and nothing has been lost. Saving yours replaces the newer calendar with what is
            on this page; taking theirs throws your edits away.
          </p>
          <div className="rc-clash-actions">
            <button
              type="button"
              className="rc-primary"
              disabled={saving}
              onClick={() => save({ ...draft, revision: clash.theirs.revision })}
            >
              <Save size={14} /> Save mine over theirs
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                startFrom(clash.theirs);
                setClash(undefined);
              }}
            >
              <RotateCcw size={14} /> Take theirs instead
            </button>
          </div>
        </div>
      )}

      <div className="rc-calendar-columns">
        <section className="rc-panel-block">
          <header>
            <h3>Shape of a year</h3>
          </header>
          <div className="rc-field-grid">
            <label>
              <span>Days per week</span>
              <input
                type="number"
                min={1}
                max={20}
                value={draft.daysPerWeek}
                onChange={(event) => set("daysPerWeek", Number(event.target.value) || 1)}
              />
            </label>
            <label>
              <span>Days per month</span>
              <input
                type="number"
                min={1}
                max={400}
                value={draft.daysPerMonth}
                onChange={(event) => set("daysPerMonth", Number(event.target.value) || 1)}
              />
            </label>
            <label>
              <span>Parts per day</span>
              <input
                type="number"
                min={1}
                max={100}
                value={draft.segmentsPerDay}
                onChange={(event) => {
                  const segmentsPerDay = Math.max(1, Math.min(100, Number(event.target.value) || 1));
                  setDraft((current) => ({
                    ...current,
                    segmentsPerDay,
                    segment: Math.min(current.segment, segmentsPerDay - 1)
                  }));
                }}
              />
            </label>
          </div>

          <header className="rc-subheader">
            <h3>Where the game starts</h3>
            <small className="room-config-muted">Advancing time stays in the room</small>
          </header>
          <div className="rc-field-grid">
            <label>
              <span>Year</span>
              <input
                type="number"
                value={draft.year}
                onChange={(event) => set("year", Number(event.target.value) || 1)}
              />
            </label>
            <label>
              <span>Month</span>
              <select value={draft.month} onChange={(event) => set("month", Number(event.target.value))}>
                {draft.monthNames.map((name, index) => (
                  <option key={index} value={index}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Day</span>
              <input
                type="number"
                min={1}
                max={draft.daysPerMonth}
                value={draft.day}
                onChange={(event) => set("day", Number(event.target.value) || 1)}
              />
            </label>
            <label>
              <span>Part of the day</span>
              <select
                value={draft.segment}
                disabled={draft.segmentsPerDay === 1}
                onChange={(event) => set("segment", Number(event.target.value))}
              >
                {Array.from({ length: draft.segmentsPerDay }, (_, index) => (
                  <option key={index} value={index}>
                    {calendarSegmentLabel(draft, index)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {warnings.length > 0 && (
            <ul className="rc-warnings">
              {warnings.map((warning) => (
                <li key={warning}>
                  <TriangleAlert size={13} /> {warning}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="rc-calendar-names">
          <NameListEditor
            title="Months"
            hint={`${draft.monthNames.length} in a year`}
            names={draft.monthNames}
            placeholder="New month"
            onChange={(names) => setNames("monthNames", names)}
          />
          <NameListEditor
            title="Days of the week"
            hint={`${draft.daysPerWeek} in a week`}
            names={draft.dayNames}
            placeholder="New day"
            onChange={(names) => setNames("dayNames", names)}
          />
          <NameListEditor
            title="Parts of a day"
            hint={draft.segmentsPerDay === 1 ? "Optional" : `${draft.segmentsPerDay} in a day`}
            names={draft.segmentNames}
            placeholder="New part"
            onChange={(names) => setNames("segmentNames", names)}
          />
        </div>
      </div>

      <section className="rc-panel-block">
        <header>
          <h3>Holidays and recurring events</h3>
          <button
            type="button"
            onClick={() =>
              set("events", [
                ...draft.events,
                {
                  id: crypto.randomUUID(),
                  name: "New event",
                  cadence: "monthly",
                  day: 1,
                  // The anchor a counted cadence needs, taken from where the
                  // room is, so switching to one lands on the game not year one.
                  month: draft.month,
                  startYear: draft.year,
                  intervalDays: draft.daysPerWeek,
                  durationDays: 1,
                  hidden: false
                }
              ])
            }
          >
            <Plus size={14} /> Add event
          </button>
        </header>
        {draft.events.length === 0 ? (
          <p className="room-config-muted">No events yet.</p>
        ) : (
          <div className="rc-table-wrap">
            <table className="rc-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Repeats</th>
                  <th scope="col">Starts</th>
                  <th scope="col">Day</th>
                  <th scope="col">Lasts</th>
                  <th scope="col">Players</th>
                  <th scope="col" className="rc-actions-column" />
                </tr>
              </thead>
              <tbody>
                {draft.events.map((event) => {
                  const weekly = event.cadence === "weekly";
                  const counted = calendarEventIsCounted(event);
                  const never = calendarEventNever(draft, event);
                  const change = (patch: Partial<CalendarEvent>) =>
                    set(
                      "events",
                      draft.events.map((item) => (item.id === event.id ? { ...item, ...patch } : item))
                    );
                  return (
                    <tr key={event.id}>
                      <td>
                        <input
                          aria-label="Event name"
                          value={event.name}
                          onChange={(changed) => change({ name: changed.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          aria-label="How often it repeats"
                          value={event.cadence}
                          onChange={(changed) => change({ cadence: changed.target.value as CalendarEventCadence })}
                        >
                          {CALENDAR_CADENCES.map((cadence) => (
                            <option key={cadence.value} value={cadence.value}>
                              {cadence.label}
                            </option>
                          ))}
                        </select>
                        {event.cadence === "interval" && (
                          <label className="rc-duration">
                            <span className="room-config-muted">every</span>
                            <input
                              type="number"
                              min={1}
                              max={400}
                              aria-label={`Days between each ${event.name}`}
                              value={calendarEventPeriod(draft, event)}
                              onChange={(changed) =>
                                change({ intervalDays: Math.max(1, Number(changed.target.value) || 1) })
                              }
                            />
                            <span className="room-config-muted">days</span>
                          </label>
                        )}
                      </td>
                      <td>
                        {/* A holiday names its month; a counted cadence names
                            the month and year its cycle is measured from. */}
                        {event.cadence === "holiday" || counted ? (
                          <div className="rc-event-anchor">
                            <select
                              aria-label={counted ? `Month ${event.name} starts in` : "Month"}
                              value={event.month ?? 0}
                              onChange={(changed) => change({ month: Number(changed.target.value) })}
                            >
                              {draft.monthNames.map((name, index) => (
                                <option key={index} value={index}>
                                  {name}
                                </option>
                              ))}
                            </select>
                            {counted && (
                              <input
                                type="number"
                                aria-label={`Year ${event.name} starts in`}
                                value={event.startYear ?? draft.year}
                                onChange={(changed) => change({ startYear: Number(changed.target.value) || 1 })}
                              />
                            )}
                          </div>
                        ) : (
                          <span className="room-config-muted">
                            {event.cadence === "weekly" ? "Every week" : "Every month"}
                          </span>
                        )}
                      </td>
                      <td>
                        <input
                          type="number"
                          min={1}
                          max={weekly ? draft.daysPerWeek : draft.daysPerMonth}
                          aria-label={weekly ? "Day of the week" : "Day of the month"}
                          value={event.day}
                          onChange={(changed) => change({ day: Number(changed.target.value) || 1 })}
                        />
                        {/* An event with nowhere to fall is drawn nowhere, and
                            nothing else on this page would ever say so. */}
                        {never && (
                          <small className="rc-event-never">
                            <TriangleAlert size={12} /> {never}
                          </small>
                        )}
                      </td>
                      <td>
                        <label className="rc-duration">
                          <input
                            type="number"
                            min={1}
                            max={400}
                            aria-label={`Days ${event.name} lasts`}
                            value={calendarEventDays(event)}
                            onChange={(changed) =>
                              change({ durationDays: Math.max(1, Number(changed.target.value) || 1) })
                            }
                          />
                          <span className="room-config-muted">{calendarEventDays(event) === 1 ? "day" : "days"}</span>
                        </label>
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`rc-visibility${event.hidden ? " hidden" : ""}`}
                          aria-pressed={!event.hidden}
                          title={event.hidden ? `Show ${event.name} to players` : `Hide ${event.name} from players`}
                          onClick={() => change({ hidden: !event.hidden })}
                        >
                          {event.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                          {event.hidden ? "Hidden" : "Shown"}
                        </button>
                      </td>
                      <td className="rc-actions-column">
                        <button
                          type="button"
                          className="rc-danger"
                          title={`Remove ${event.name}`}
                          onClick={() =>
                            set(
                              "events",
                              draft.events.filter((item) => item.id !== event.id)
                            )
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="rc-save-bar">
        <button type="button" className="rc-primary" disabled={!dirty || saving} onClick={() => save()}>
          <Save size={14} /> {saving ? "Saving…" : dirty ? "Save the calendar" : "Saved"}
        </button>
        <button type="button" disabled={!dirty || saving} onClick={() => setDraft(baseline)}>
          <RotateCcw size={14} /> Discard changes
        </button>
        <span className="room-config-muted">Revision {draft.revision}</span>
      </footer>
    </div>
  );
}

/** One named list — months, weekdays, parts of a day — as rows rather than a comma-separated line. */
function NameListEditor({
  title,
  hint,
  names,
  placeholder,
  onChange
}: {
  title: string;
  hint: string;
  names: string[];
  placeholder: string;
  onChange: (names: string[]) => void;
}) {
  return (
    <section className="rc-panel-block rc-name-list">
      <header>
        <h3>{title}</h3>
        <small className="room-config-muted">{hint}</small>
      </header>
      <ol>
        {names.map((name, index) => (
          <li key={index}>
            <span className="rc-ordinal">{index + 1}</span>
            <input
              value={name}
              aria-label={`${title} ${index + 1}`}
              onChange={(event) => onChange(names.map((item, at) => (at === index ? event.target.value : item)))}
            />
            <button
              type="button"
              title="Move up"
              disabled={index === 0}
              onClick={() => onChange(move(names, index, index - 1))}
            >
              <ArrowUp size={13} />
            </button>
            <button
              type="button"
              title="Move down"
              disabled={index === names.length - 1}
              onClick={() => onChange(move(names, index, index + 1))}
            >
              <ArrowDown size={13} />
            </button>
            <button
              type="button"
              className="rc-danger"
              title={`Remove ${name || "this"}`}
              onClick={() => onChange(names.filter((_, at) => at !== index))}
            >
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ol>
      <button type="button" onClick={() => onChange([...names, placeholder])}>
        <Plus size={14} /> Add
      </button>
    </section>
  );
}
