import { useMemo, useState } from "react";
import { ChevronRight, Plus, Settings2, Trash2, X } from "lucide-react";
import type { CalendarEvent, CalendarEventCadence, RoomCalendar } from "@devils-toys/shared";
import { api } from "./api";

export function CalendarModal({
  roomId,
  calendar,
  isGm,
  onChanged,
  onClose
}: {
  roomId: number;
  calendar: RoomCalendar;
  isGm: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(calendar);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const firstWeekday =
    (((calendar.month * calendar.daysPerMonth) % calendar.daysPerWeek) + calendar.daysPerWeek) % calendar.daysPerWeek;
  const cells = useMemo(
    () =>
      Array.from({ length: firstWeekday + calendar.daysPerMonth }, (_, index) =>
        index < firstWeekday ? null : index - firstWeekday + 1
      ),
    [firstWeekday, calendar.daysPerMonth]
  );

  function eventsFor(day: number) {
    const weekday = ((firstWeekday + day - 1) % calendar.daysPerWeek) + 1;
    const absoluteWeek = Math.floor((calendar.month * calendar.daysPerMonth + day - 1) / calendar.daysPerWeek);
    return calendar.events.filter((event) => {
      if (event.cadence === "holiday") return event.day === day && event.month === calendar.month;
      if (event.cadence === "monthly") return event.day === day;
      if (event.cadence === "biweekly") return event.day === weekday && absoluteWeek % 2 === 0;
      return event.day === weekday;
    });
  }

  async function advance() {
    setError("");
    try {
      await api(`/api/rooms/${roomId}/calendar/advance`, { method: "POST" });
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      await api(`/api/rooms/${roomId}/calendar`, { method: "PUT", body: JSON.stringify(draft) });
      setEditing(false);
      onChanged();
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
            {calendar.segmentNames.length > 0 && (
              <p className="calendar-segment">{calendar.segmentNames[calendar.segment]}</p>
            )}
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
              style={{ gridTemplateColumns: `repeat(${calendar.daysPerWeek}, minmax(0, 1fr))` }}
            >
              {Array.from({ length: calendar.daysPerWeek }, (_, i) => (
                <strong key={i}>{calendar.dayNames[i] ?? `Day ${i + 1}`}</strong>
              ))}
              {cells.map((day, index) =>
                day === null ? (
                  <span className="calendar-blank" key={`b${index}`} />
                ) : (
                  <button
                    key={day}
                    className={`calendar-day ${day === calendar.day ? "current" : ""}`}
                    onClick={day === calendar.day && isGm ? advance : undefined}
                    title={day === calendar.day && isGm ? "Advance time" : undefined}
                  >
                    <b>{day}</b>
                    {eventsFor(day).map((event) => (
                      <small key={event.id}>{event.name}</small>
                    ))}
                    {day === calendar.day && isGm && <ChevronRight className="calendar-advance" size={15} />}
                  </button>
                )
              )}
            </div>
            {isGm && (
              <p className="calendar-hint">
                Click the current day to advance to the next {calendar.segmentNames.length ? "part of the day" : "day"}.
              </p>
            )}
          </>
        )}
        {error && <p className="form-error">{error}</p>}
      </section>
    </div>
  );
}

function splitNames(value: string) {
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
            disabled={!value.segmentNames.length}
            onChange={(e) => set("segment", Number(e.target.value))}
          >
            {value.segmentNames.map((name, i) => (
              <option value={i} key={i}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Names of days <small>Comma separated</small>
        <input value={value.dayNames.join(", ")} onChange={(e) => set("dayNames", splitNames(e.target.value))} />
      </label>
      <label>
        Names of months <small>Comma separated</small>
        <textarea value={value.monthNames.join(", ")} onChange={(e) => set("monthNames", splitNames(e.target.value))} />
      </label>
      <label>
        Segments / parts of day <small>Comma separated; leave blank to advance by full days</small>
        <input
          value={value.segmentNames.join(", ")}
          onChange={(e) => set("segmentNames", splitNames(e.target.value))}
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
