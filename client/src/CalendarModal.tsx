import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { Clock3, Eye, EyeOff, Plus, Settings2, Trash2, TriangleAlert, X } from "lucide-react";
import {
  advanceCalendar,
  CALENDAR_CADENCES,
  calendarDayIsPast,
  calendarDayProgress,
  calendarEventDays,
  calendarEventIsCounted,
  calendarEventNever,
  calendarEventPeriod,
  calendarEventsOn,
  calendarFirstWeekday,
  calendarSegmentLabel,
  type CalendarEvent,
  type CalendarEventCadence,
  type RoomCalendar
} from "@devils-toys/shared";
import { api } from "./api";

export function CalendarModal({
  roomId,
  calendar: serverCalendar,
  isGm,
  onChanged,
  onClose
}: {
  roomId: number;
  calendar: RoomCalendar;
  isGm: boolean;
  onChanged: (calendar: RoomCalendar) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [calendar, setCalendar] = useState(serverCalendar);
  const [draft, setDraft] = useState(serverCalendar);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [addingTo, setAddingTo] = useState<{ year: number; month: number; day: number }>();
  const [settingTime, setSettingTime] = useState(false);
  const [viewMonth, setViewMonth] = useState(serverCalendar.month);
  const [viewYear, setViewYear] = useState(serverCalendar.year);
  const firstWeekday = calendarFirstWeekday(calendar, viewYear, viewMonth);
  const currentPage = viewMonth === calendar.month && viewYear === calendar.year;
  const yearOptions = useMemo(() => Array.from({ length: 41 }, (_, index) => viewYear - 20 + index), [viewYear]);
  const cells = useMemo(
    () =>
      Array.from({ length: firstWeekday + calendar.daysPerMonth }, (_, index) =>
        index < firstWeekday ? null : index - firstWeekday + 1
      ),
    [firstWeekday, calendar.daysPerMonth]
  );

  useEffect(() => {
    setCalendar(serverCalendar);
    if (!editing) setDraft(serverCalendar);
  }, [serverCalendar, editing]);

  useEffect(() => {
    setViewMonth(calendar.month);
    setViewYear(calendar.year);
  }, [calendar.month, calendar.year]);

  function acceptCalendar(next: RoomCalendar) {
    setCalendar(next);
    setDraft(next);
    onChanged(next);
  }

  async function advance() {
    if (advancing) return;
    setError("");
    const previous = calendar;
    const optimistic = advanceCalendar(calendar);
    setCalendar(optimistic);
    setAdvancing(true);
    try {
      const result = await api<{ calendar: RoomCalendar }>(`/api/rooms/${roomId}/calendar/advance`, {
        method: "POST"
      });
      acceptCalendar(result.calendar);
    } catch (cause) {
      setCalendar((current) => (current === optimistic ? previous : current));
      setError((cause as Error).message);
    } finally {
      setAdvancing(false);
    }
  }

  async function addEntry(input: { name: string; year: number; month: number; day: number; hidden: boolean }) {
    const result = await api<{ calendar: RoomCalendar }>(`/api/rooms/${roomId}/calendar/events`, {
      method: "POST",
      body: JSON.stringify(input)
    });
    acceptCalendar(result.calendar);
  }

  async function setTime(input: { year: number; month: number; day: number; segment: number }) {
    const result = await api<{ calendar: RoomCalendar }>(`/api/rooms/${roomId}/calendar/set-time`, {
      method: "POST",
      body: JSON.stringify(input)
    });
    acceptCalendar(result.calendar);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const result = await api<{ calendar: RoomCalendar }>(`/api/rooms/${roomId}/calendar`, {
        method: "PUT",
        body: JSON.stringify(draft)
      });
      setCalendar(result.calendar);
      setDraft(result.calendar);
      setEditing(false);
      onChanged(result.calendar);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-scrim calendar-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="modal calendar-modal" role="dialog" aria-modal="true" aria-label="Calendar">
        <header className="calendar-header">
          <div className="calendar-period">
            <p className="eyebrow">Calendar</p>
            <h2 className="calendar-heading">
              <select
                className="calendar-month-select"
                aria-label="Displayed month"
                value={viewMonth}
                onChange={(event) => setViewMonth(Number(event.target.value))}
              >
                {calendar.monthNames.map((name, index) => (
                  <option value={index} key={index}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                className="calendar-year-select"
                aria-label="Displayed year"
                value={viewYear}
                onChange={(event) => setViewYear(Number(event.target.value))}
              >
                {yearOptions.map((year) => (
                  <option value={year} key={year}>
                    {year}
                  </option>
                ))}
              </select>
            </h2>
          </div>
          <div className="calendar-now" aria-label="Current calendar time">
            <span>Current time</span>
            <strong>
              {calendar.monthNames[calendar.month]} {calendar.day}, {calendar.year}
            </strong>
            {calendar.segmentsPerDay > 1 && <small>{calendarSegmentLabel(calendar)}</small>}
          </div>
          <div className="calendar-actions">
            {isGm && (
              <button className="icon-button" title="Configure calendar" onClick={() => setEditing(!editing)}>
                <Settings2 />
              </button>
            )}
            <button className="icon-button" aria-label="Close calendar" onClick={onClose}>
              <X />
            </button>
          </div>
        </header>
        {editing ? (
          <CalendarEditor value={draft} onChange={setDraft} onSave={save} saving={saving} />
        ) : (
          <>
            <div
              className="calendar-week"
              style={{
                gridTemplateColumns: `repeat(${calendar.daysPerWeek}, minmax(0, 1fr))`,
                minWidth: `${calendar.daysPerWeek * 118}px`
              }}
            >
              {Array.from({ length: calendar.daysPerWeek }, (_, i) => (
                <strong key={i}>{calendar.dayNames[i] ?? `Day ${i + 1}`}</strong>
              ))}
              {cells.map((day, index) => {
                if (day === null) return <span className="calendar-blank" key={`b${index}`} />;
                const current = currentPage && day === calendar.day;
                const past = calendarDayIsPast(calendar, viewYear, viewMonth, day);
                const style = current
                  ? ({
                      "--calendar-progress": `${calendarDayProgress(calendar) * 100}%`
                    } as CSSProperties)
                  : undefined;
                return (
                  <article
                    key={day}
                    className={`calendar-day${current ? " current" : ""}${past ? " past" : ""}`}
                    style={style}
                    aria-current={current ? "date" : undefined}
                  >
                    <div className="calendar-day-heading">
                      <b>{day}</b>
                      <button
                        className="calendar-day-add"
                        aria-label={`Add an event or note to ${calendar.monthNames[viewMonth]} ${day}, ${viewYear}`}
                        title="Add event or note"
                        onClick={() => setAddingTo({ year: viewYear, month: viewMonth, day })}
                      >
                        <Plus size={15} />
                      </button>
                    </div>
                    {calendarEventsOn(calendar, viewYear, viewMonth, day).map(({ event, dayOfRun }) => {
                      const days = calendarEventDays(event);
                      return (
                        <small
                          key={event.id}
                          className={`calendar-event${dayOfRun > 1 ? " running" : ""}${
                            event.hidden ? " hidden-event" : ""
                          }`}
                          title={days > 1 ? `${event.name} · day ${dayOfRun} of ${days}` : event.name}
                        >
                          {event.hidden && <EyeOff size={11} aria-label="Hidden from players" />}
                          <span className="calendar-event-name">{event.name}</span>
                          {days > 1 && (
                            <span className="calendar-event-run">
                              {dayOfRun}/{days}
                            </span>
                          )}
                        </small>
                      );
                    })}
                  </article>
                );
              })}
            </div>
            <footer className="calendar-footer">
              <p>
                {currentPage ? "Viewing the current month." : `Viewing ${calendar.monthNames[viewMonth]} ${viewYear}.`}
              </p>
              {isGm && (
                <div className="calendar-time-actions">
                  <button className="secondary-button" onClick={() => setSettingTime(true)}>
                    <Clock3 size={16} /> Set time
                  </button>
                  <button className="primary-button" disabled={advancing} aria-busy={advancing} onClick={advance}>
                    <Plus size={16} />{" "}
                    {advancing ? "Advancing…" : `1 ${calendar.segmentsPerDay > 1 ? "segment" : "day"}`}
                  </button>
                </div>
              )}
            </footer>
          </>
        )}
        {error && <p className="form-error">{error}</p>}
      </section>
      {addingTo && (
        <CalendarEntryDialog
          calendar={calendar}
          date={addingTo}
          isGm={isGm}
          onAdd={addEntry}
          onClose={() => setAddingTo(undefined)}
        />
      )}
      {settingTime && <CalendarTimeDialog calendar={calendar} onSet={setTime} onClose={() => setSettingTime(false)} />}
    </div>
  );
}

function CalendarEntryDialog({
  calendar,
  date,
  isGm,
  onAdd,
  onClose
}: {
  calendar: RoomCalendar;
  date: { year: number; month: number; day: number };
  isGm: boolean;
  onAdd: (input: { name: string; year: number; month: number; day: number; hidden: boolean }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [hidden, setHidden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      await onAdd({ name: name.trim(), ...date, hidden });
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-scrim calendar-dialog-scrim"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        className="modal calendar-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-entry-title"
        onSubmit={submit}
      >
        <div className="calendar-dialog-header">
          <div>
            <p className="eyebrow">
              {calendar.monthNames[date.month]} {date.day}, {date.year}
            </p>
            <h3 id="calendar-entry-title">Add event or note</h3>
          </div>
          <button className="icon-button" type="button" aria-label="Close event form" onClick={onClose}>
            <X />
          </button>
        </div>
        <label>
          Event or note
          <input
            autoFocus
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="What happens?"
          />
        </label>
        {isGm && (
          <label className="calendar-dialog-check">
            <input type="checkbox" checked={hidden} onChange={(event) => setHidden(event.target.checked)} />
            <span>
              <strong>GM only</strong>
              <small>Keep this entry hidden from players.</small>
            </span>
          </label>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="calendar-dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={!name.trim() || saving}>
            <Plus size={16} /> {saving ? "Adding…" : "Add to day"}
          </button>
        </div>
      </form>
    </div>
  );
}

function CalendarTimeDialog({
  calendar,
  onSet,
  onClose
}: {
  calendar: RoomCalendar;
  onSet: (input: { year: number; month: number; day: number; segment: number }) => Promise<void>;
  onClose: () => void;
}) {
  const [year, setYear] = useState(calendar.year);
  const [month, setMonth] = useState(calendar.month);
  const [day, setDay] = useState(calendar.day);
  const [segment, setSegment] = useState(calendar.segment);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await onSet({ year, month, day, segment });
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-scrim calendar-dialog-scrim"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        className="modal calendar-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-time-title"
        onSubmit={submit}
      >
        <div className="calendar-dialog-header">
          <div>
            <p className="eyebrow">Calendar controls</p>
            <h3 id="calendar-time-title">Set time</h3>
          </div>
          <button className="icon-button" type="button" aria-label="Close set time form" onClick={onClose}>
            <X />
          </button>
        </div>
        <p className="calendar-dialog-intro">Move the calendar to an exact date in the past or future.</p>
        <div className="calendar-time-grid">
          <label>
            Year
            <input
              type="number"
              min={-99999}
              max={99999}
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
            />
          </label>
          <label>
            Month
            <select value={month} onChange={(event) => setMonth(Number(event.target.value))}>
              {calendar.monthNames.map((name, index) => (
                <option value={index} key={index}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Day
            <input
              type="number"
              min={1}
              max={calendar.daysPerMonth}
              value={day}
              onChange={(event) => setDay(Number(event.target.value))}
            />
          </label>
          {calendar.segmentsPerDay > 1 && (
            <label>
              Segment
              <select value={segment} onChange={(event) => setSegment(Number(event.target.value))}>
                {Array.from({ length: calendar.segmentsPerDay }, (_, index) => (
                  <option value={index} key={index}>
                    {calendarSegmentLabel(calendar, index)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="calendar-dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={saving}>
            {saving ? "Setting…" : "Set time"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function splitCalendarNames(value: string) {
  return value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}
function CalendarEditor({
  value,
  onChange,
  onSave,
  saving
}: {
  value: RoomCalendar;
  onChange: (value: RoomCalendar) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const set = <K extends keyof RoomCalendar>(key: K, next: RoomCalendar[K]) => onChange({ ...value, [key]: next });
  const [dayNamesText, setDayNamesText] = useState(value.dayNames.join(", "));
  const [monthNamesText, setMonthNamesText] = useState(value.monthNames.join(", "));
  const [segmentNamesText, setSegmentNamesText] = useState(value.segmentNames.join(", "));
  function updateNames(
    key: "dayNames" | "monthNames" | "segmentNames",
    text: string,
    updateText: (next: string) => void
  ) {
    updateText(text);
    set(key, splitCalendarNames(text));
  }
  function addEvent() {
    set("events", [
      ...value.events,
      {
        id: crypto.randomUUID(),
        name: "New event",
        cadence: "monthly",
        day: 1,
        // The anchor a counted cadence needs, taken from where the room
        // actually is, so switching to one lands on the game and not year one.
        month: value.month,
        startYear: value.year,
        intervalDays: value.daysPerWeek,
        durationDays: 1,
        hidden: false
      }
    ]);
  }
  function eventChange(id: string, patch: Partial<CalendarEvent>) {
    set(
      "events",
      value.events.map((event) => (event.id === id ? { ...event, ...patch } : event))
    );
  }
  return (
    <div className="calendar-editor settings-list">
      <div className="calendar-config-grid">
        <label>
          Current year
          <input type="number" value={value.year} onChange={(e) => set("year", Number(e.target.value))} />
        </label>
        <label>
          Current month
          <select value={value.month} onChange={(e) => set("month", Number(e.target.value))}>
            {value.monthNames.map((name, i) => (
              <option value={i} key={i}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Current day
          <input
            type="number"
            min="1"
            max={value.daysPerMonth}
            value={value.day}
            onChange={(e) => set("day", Number(e.target.value))}
          />
        </label>
        <label>
          Days per week
          <input
            type="number"
            min="1"
            max="20"
            value={value.daysPerWeek}
            onChange={(e) => set("daysPerWeek", Number(e.target.value))}
          />
        </label>
        <label>
          Days per month
          <input
            type="number"
            min="1"
            max="400"
            value={value.daysPerMonth}
            onChange={(e) => set("daysPerMonth", Number(e.target.value))}
          />
        </label>
        <label>
          Current segment
          <select
            value={value.segment}
            disabled={value.segmentsPerDay === 1}
            onChange={(e) => set("segment", Number(e.target.value))}
          >
            {Array.from({ length: value.segmentsPerDay }, (_, i) => (
              <option value={i} key={i}>
                {calendarSegmentLabel(value, i)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Segments per day
          <input
            type="number"
            min="1"
            max="100"
            value={value.segmentsPerDay}
            onChange={(e) => {
              const segmentsPerDay = Math.max(1, Math.min(100, Number(e.target.value) || 1));
              onChange({
                ...value,
                segmentsPerDay,
                segment: Math.min(value.segment, segmentsPerDay - 1)
              });
            }}
          />
        </label>
      </div>
      <label className="calendar-name-list">
        Names of days <small>Comma separated</small>
        <input
          value={dayNamesText}
          onChange={(event) => updateNames("dayNames", event.target.value, setDayNamesText)}
        />
      </label>
      <label className="calendar-name-list">
        Names of months <small>Comma separated</small>
        <input
          value={monthNamesText}
          onChange={(event) => updateNames("monthNames", event.target.value, setMonthNamesText)}
        />
      </label>
      <label className="calendar-name-list">
        Segment names <small>Comma separated · optional</small>
        <input
          value={segmentNamesText}
          onChange={(event) => updateNames("segmentNames", event.target.value, setSegmentNamesText)}
        />
      </label>
      <div className="calendar-events-title">
        <h3>Calendar entries</h3>
        <button onClick={addEvent}>
          <Plus size={16} /> Add event
        </button>
      </div>
      {value.events.map((event) => {
        const counted = calendarEventIsCounted(event);
        const oneTime = event.cadence === "once";
        const dated = oneTime || event.cadence === "holiday" || counted;
        const never = calendarEventNever(value, event);
        return (
          <div className="calendar-event-row" key={event.id}>
            <div className="calendar-event-editor">
              <input
                aria-label="Event name"
                value={event.name}
                onChange={(e) => eventChange(event.id, { name: e.target.value })}
              />
              <span className="calendar-event-repeats">
                <select
                  aria-label="Recurrence"
                  value={event.cadence}
                  onChange={(e) => {
                    const cadence = e.target.value as CalendarEventCadence;
                    const needsExactDate = cadence === "once" || cadence === "biweekly" || cadence === "interval";
                    eventChange(event.id, {
                      cadence,
                      ...(needsExactDate
                        ? { month: event.month ?? value.month, startYear: event.startYear ?? value.year }
                        : {})
                    });
                  }}
                >
                  {CALENDAR_CADENCES.map((cadence) => (
                    <option value={cadence.value} key={cadence.value}>
                      {cadence.label}
                    </option>
                  ))}
                </select>
                {event.cadence === "interval" && (
                  <input
                    type="number"
                    min="1"
                    max="400"
                    aria-label={`Days between each ${event.name}`}
                    value={calendarEventPeriod(value, event)}
                    onChange={(e) => eventChange(event.id, { intervalDays: Math.max(1, Number(e.target.value) || 1) })}
                  />
                )}
              </span>
              {/* One cell for when it happens: a holiday names its month, while
                  a one-time or counted event names an exact date. */}
              {dated ? (
                <label>
                  {oneTime ? "Date" : counted ? "Starts" : "Month"}
                  <span className="calendar-event-anchor">
                    <select
                      aria-label={oneTime || counted ? `Month ${event.name} starts in` : "Event month"}
                      value={event.month ?? 0}
                      onChange={(e) => eventChange(event.id, { month: Number(e.target.value) })}
                    >
                      {value.monthNames.map((name, i) => (
                        <option value={i} key={i}>
                          {name}
                        </option>
                      ))}
                    </select>
                    {(oneTime || counted) && (
                      <input
                        type="number"
                        aria-label={`Year ${event.name} starts in`}
                        value={event.startYear ?? value.year}
                        onChange={(e) => eventChange(event.id, { startYear: Number(e.target.value) || 1 })}
                      />
                    )}
                  </span>
                </label>
              ) : (
                // An occupied cell rather than a missing one, so the row's columns
                // line up with a holiday's above it instead of sliding one left.
                <span className="calendar-event-every-month">
                  {event.cadence === "weekly" ? "Every week" : "Every month"}
                </span>
              )}
              <label>
                {event.cadence === "weekly" ? "Weekday" : "Day"}
                <input
                  type="number"
                  min="1"
                  max={event.cadence === "weekly" ? value.daysPerWeek : value.daysPerMonth}
                  value={event.day}
                  onChange={(e) => eventChange(event.id, { day: Number(e.target.value) })}
                />
              </label>
              <label>
                Days long
                <input
                  type="number"
                  min="1"
                  max="400"
                  aria-label={`Days ${event.name} lasts`}
                  value={calendarEventDays(event)}
                  onChange={(e) => eventChange(event.id, { durationDays: Math.max(1, Number(e.target.value) || 1) })}
                />
              </label>
              <button
                className="icon-button"
                aria-pressed={!event.hidden}
                title={event.hidden ? `Show ${event.name} to players` : `Hide ${event.name} from players`}
                onClick={() => eventChange(event.id, { hidden: !event.hidden })}
              >
                {event.hidden ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              <button
                className="icon-button"
                title="Remove event"
                onClick={() =>
                  set(
                    "events",
                    value.events.filter((item) => item.id !== event.id)
                  )
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
            {never && (
              <p className="calendar-event-never">
                <TriangleAlert size={13} /> {never}
              </p>
            )}
          </div>
        );
      })}
      <button
        className="primary-button"
        disabled={saving || !value.dayNames.length || !value.monthNames.length}
        onClick={onSave}
      >
        {saving ? "Saving…" : "Save calendar"}
      </button>
    </div>
  );
}
