import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ChevronRight, Plus, Settings2, Trash2, X } from "lucide-react";
import {
  advanceCalendar,
  calendarDayIndex,
  calendarDayIsPast,
  calendarDayProgress,
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

  function eventsFor(day: number) {
    const weekday = ((firstWeekday + day - 1) % calendar.daysPerWeek) + 1;
    const absoluteWeek = Math.floor(calendarDayIndex(calendar, viewYear, viewMonth, day) / calendar.daysPerWeek);
    return calendar.events.filter((event) => {
      if (event.cadence === "holiday") return event.day === day && event.month === viewMonth;
      if (event.cadence === "monthly") return event.day === day;
      if (event.cadence === "biweekly") return event.day === weekday && absoluteWeek % 2 === 0;
      return event.day === weekday;
    });
  }

  async function advance() {
    if (advancing) return;
    setError("");
    const previous = calendar;
    setCalendar(advanceCalendar(calendar));
    setAdvancing(true);
    try {
      const result = await api<{ calendar: RoomCalendar }>(`/api/rooms/${roomId}/calendar/advance`, {
        method: "POST"
      });
      setCalendar(result.calendar);
      onChanged(result.calendar);
    } catch (cause) {
      setCalendar(previous);
      setError((cause as Error).message);
    } finally {
      setAdvancing(false);
    }
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
    <div className="modal-scrim calendar-scrim" role="presentation">
      <section className="modal calendar-modal" role="dialog" aria-modal="true" aria-label="Calendar">
        <header className="calendar-header">
          <div>
            <p className="eyebrow">Year {calendar.year}</p>
            <h2>
              {calendar.monthNames[calendar.month]} · Day {calendar.day}
            </h2>
            {calendar.segmentsPerDay > 1 && <p className="calendar-segment">{calendarSegmentLabel(calendar)}</p>}
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
            <div className="calendar-view-controls" aria-label="Displayed month and year">
              <label>
                Month
                <select value={viewMonth} onChange={(event) => setViewMonth(Number(event.target.value))}>
                  {calendar.monthNames.map((name, index) => (
                    <option value={index} key={index}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Year
                <select value={viewYear} onChange={(event) => setViewYear(Number(event.target.value))}>
                  {yearOptions.map((year) => (
                    <option value={year} key={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div
              className="calendar-week"
              style={{ gridTemplateColumns: `repeat(${calendar.daysPerWeek}, minmax(0, 1fr))` }}
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
                  <button
                    key={day}
                    className={`calendar-day${current ? " current" : ""}${past ? " past" : ""}`}
                    style={style}
                    aria-current={current ? "date" : undefined}
                    aria-busy={current && advancing ? true : undefined}
                    disabled={current && isGm && advancing}
                    onClick={current && isGm ? advance : undefined}
                    title={
                      current && isGm ? (advancing ? "Advancing time…" : "Advance time") : past ? "Past day" : undefined
                    }
                  >
                    <b>{day}</b>
                    {eventsFor(day).map((event) => (
                      <small key={event.id}>{event.name}</small>
                    ))}
                    {current && isGm && <ChevronRight className="calendar-advance" size={15} />}
                  </button>
                );
              })}
            </div>
            {isGm && (
              <p className="calendar-hint">
                {currentPage
                  ? `Click the current day to advance to the next ${
                      calendar.segmentsPerDay > 1 ? "segment of the day" : "day"
                    }.`
                  : "Return to the current month and year to advance time."}
              </p>
            )}
          </>
        )}
        {error && <p className="form-error">{error}</p>}
      </section>
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
    set("events", [...value.events, { id: crypto.randomUUID(), name: "New event", cadence: "monthly", day: 1 }]);
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
        <h3>Holidays & recurring events</h3>
        <button onClick={addEvent}>
          <Plus size={16} /> Add event
        </button>
      </div>
      {value.events.map((event) => (
        <div className="calendar-event-editor" key={event.id}>
          <input
            aria-label="Event name"
            value={event.name}
            onChange={(e) => eventChange(event.id, { name: e.target.value })}
          />
          <select
            aria-label="Recurrence"
            value={event.cadence}
            onChange={(e) => eventChange(event.id, { cadence: e.target.value as CalendarEventCadence })}
          >
            <option value="holiday">Holiday (yearly)</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="monthly">Monthly</option>
          </select>
          {event.cadence === "holiday" && (
            <select
              aria-label="Event month"
              value={event.month ?? 0}
              onChange={(e) => eventChange(event.id, { month: Number(e.target.value) })}
            >
              {value.monthNames.map((name, i) => (
                <option value={i} key={i}>
                  {name}
                </option>
              ))}
            </select>
          )}
          <label>
            {event.cadence === "weekly" || event.cadence === "biweekly" ? "Weekday" : "Day"}
            <input
              type="number"
              min="1"
              value={event.day}
              onChange={(e) => eventChange(event.id, { day: Number(e.target.value) })}
            />
          </label>
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
      ))}
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
