"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { HouseholdUserRecord, UnscheduledRecord } from "@/lib/db/queries";
import {
  addDaysToDateKey,
  formatDateKey,
  householdDateKey,
  householdSaturdayKey,
} from "@/lib/datetime";
import { MEAL_STATUSES, MEAL_TYPES, optionLabel } from "@/lib/options";

export function UnscheduledManager({
  items,
  users,
  timeZone,
}: {
  items: UnscheduledRecord[];
  users: HouseholdUserRecord[];
  timeZone: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [weekStart, setWeekStart] = useState(householdSaturdayKey(new Date(), timeZone));
  const [itemType, setItemType] = useState("prep");
  const [title, setTitle] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [plannedYield, setPlannedYield] = useState("");
  const [notes, setNotes] = useState("");
  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState(
    addDaysToDateKey(householdDateKey(new Date(), timeZone), 1),
  );
  const [scheduleType, setScheduleType] = useState("dinner");
  const [scheduleUserId, setScheduleUserId] = useState("");
  const [schedulePackedLunch, setSchedulePackedLunch] = useState(false);
  const [error, setError] = useState("");
  const grouped = useMemo(() => Map.groupBy(items, (item) => item.weekStart), [items]);

  async function add(event: FormEvent) {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/v1/unscheduled", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        weekStart,
        itemType,
        title,
        assignedUserId,
        plannedYield,
        status: "planned",
        notes,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return setError(body.error || "Could not add item.");
    setTitle("");
    setNotes("");
    setAdding(false);
    router.refresh();
  }

  async function patch(id: string, body: unknown) {
    const response = await fetch(`/api/v1/unscheduled/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      return window.alert((await response.json().catch(() => ({}))).error || "Update failed.");
    router.refresh();
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this unscheduled item?")) return;
    await fetch(`/api/v1/unscheduled/${id}`, { method: "DELETE" });
    router.refresh();
  }

  function startSchedule(item: UnscheduledRecord) {
    setSchedulingId(item.id);
    setScheduleDate(addDaysToDateKey(householdDateKey(new Date(), timeZone), 1));
    setScheduleType(item.itemType);
    setScheduleUserId(item.assignedUserId ?? "");
    setSchedulePackedLunch(false);
    setError("");
  }

  async function schedule(event: FormEvent) {
    event.preventDefault();
    if (!schedulingId) return;
    setError("");
    const response = await fetch(`/api/v1/unscheduled/${schedulingId}/schedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mealDate: scheduleDate,
        mealType: scheduleType,
        assignedUserId: scheduleUserId,
        packedLunch: schedulePackedLunch,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return setError(body.error || "Could not schedule item.");
    setSchedulingId(null);
    router.refresh();
  }

  return (
    <section className="section-card unscheduled-section">
      <header>
        <div>
          <span className="eyebrow">Flexible this week</span>
          <h2>Unscheduled items</h2>
          <p className="muted">
            Keep flexible cooking here, then schedule it when you know the date. Deferred meals
            return here automatically when their original day is archived.
          </p>
        </div>
        <button className="primary-button" onClick={() => setAdding(!adding)}>
          {adding ? "Close" : "Add item"}
        </button>
      </header>

      {adding && (
        <form className="entity-form compact-form" onSubmit={add}>
          <div className="form-grid">
            <label>
              Week starts
              <input
                type="date"
                required
                value={weekStart}
                onChange={(event) => setWeekStart(event.target.value)}
              />
            </label>
            <label>
              Type
              <select value={itemType} onChange={(event) => setItemType(event.target.value)}>
                {MEAL_TYPES.map((type) => (
                  <option value={type} key={type}>
                    {optionLabel(type)}
                  </option>
                ))}
              </select>
            </label>
            <label className="span-two">
              Item
              <input
                required
                placeholder="e.g. Homemade hummus"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label>
              For
              <select
                value={assignedUserId}
                onChange={(event) => setAssignedUserId(event.target.value)}
              >
                <option value="">Household</option>
                {users.map((user) => (
                  <option value={user.id} key={user.id}>
                    {user.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Planned yield
              <input
                value={plannedYield}
                onChange={(event) => setPlannedYield(event.target.value)}
              />
            </label>
            <label className="span-two">
              Notes
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
            </label>
          </div>
          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="primary-button">Add unscheduled item</button>
          </div>
        </form>
      )}
      {error && <p className="form-error">{error}</p>}

      <div className="unscheduled-groups">
        {Array.from(grouped.entries()).map(([week, entries]) => (
          <article key={week}>
            <h3>Week of {formatDateKey(week, { month: "short", day: "numeric" })}</h3>
            <div>
              {entries.map((item) => (
                <div className={`unscheduled-row ${item.status}`} key={item.id}>
                  <span>
                    <small>
                      {optionLabel(item.itemType)}
                      {item.assignedName ? ` · ${item.assignedName}` : ""}
                    </small>
                    <strong>{item.title}</strong>
                    <em>{item.plannedYield || item.notes || "No details yet"}</em>
                  </span>
                  <div className="row-actions">
                    <button onClick={() => startSchedule(item)}>Schedule</button>
                    <select
                      aria-label="Unscheduled item status"
                      value={item.status}
                      onChange={(event) => patch(item.id, { status: event.target.value })}
                    >
                      {MEAL_STATUSES.map((status) => (
                        <option value={status} key={status}>
                          {optionLabel(status)}
                        </option>
                      ))}
                    </select>
                    <button className="danger-link" onClick={() => remove(item.id)}>
                      Delete
                    </button>
                  </div>
                  {schedulingId === item.id && (
                    <form className="entity-form unscheduled-schedule-form" onSubmit={schedule}>
                      <div className="form-grid">
                        <label>
                          Date
                          <input
                            type="date"
                            min={householdDateKey(new Date(), timeZone)}
                            required
                            value={scheduleDate}
                            onChange={(event) => setScheduleDate(event.target.value)}
                          />
                        </label>
                        <label>
                          Meal
                          <select
                            value={scheduleType}
                            onChange={(event) => setScheduleType(event.target.value)}
                          >
                            {MEAL_TYPES.map((type) => (
                              <option value={type} key={type}>
                                {optionLabel(type)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          For
                          <select
                            value={scheduleUserId}
                            onChange={(event) => setScheduleUserId(event.target.value)}
                          >
                            <option value="">Household</option>
                            {users.map((user) => (
                              <option value={user.id} key={user.id}>
                                {user.displayName}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={schedulePackedLunch}
                            onChange={(event) => setSchedulePackedLunch(event.target.checked)}
                          />
                          Packed lunch
                        </label>
                      </div>
                      <div className="form-actions">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setSchedulingId(null)}
                        >
                          Cancel
                        </button>
                        <button className="primary-button">Add to meal plan</button>
                      </div>
                    </form>
                  )}
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
      {!items.length && (
        <p className="empty-state">
          Nothing flexible is recorded yet. Add homemade hummus or another this-week item here.
        </p>
      )}
    </section>
  );
}
