"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FoodPreferenceRecord, HouseholdUserRecord } from "@/lib/db/queries";
import { householdDateKey } from "@/lib/datetime";

const classifications = [
  "hard_constraint",
  "strong_preference",
  "soft_preference",
  "recipe_lesson",
  "observation",
];
function empty(timeZone: string) {
  return {
    userId: "",
    topic: "",
    classification: "strong_preference",
    detail: "",
    context: "",
    status: "active",
    effectiveDate: householdDateKey(new Date(), timeZone),
  };
}
export function PreferenceManager({
  items,
  users,
  timeZone,
}: {
  items: FoodPreferenceRecord[];
  users: HouseholdUserRecord[];
  timeZone: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState(empty(timeZone));
  const [editId, setEditId] = useState<string | null>(null);
  const [person, setPerson] = useState("all");
  const [status, setStatus] = useState("current");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          (person === "all" ||
            (person === "household" ? item.userId === null : item.userId === person)) &&
          (status === "all" ||
            (status === "current" ? item.status !== "superseded" : item.status === status)) &&
          `${item.topic} ${item.detail} ${item.context ?? ""}`
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()),
      ),
    [items, person, status, query],
  );
  function edit(item: FoodPreferenceRecord) {
    setEditId(item.id);
    setForm({
      userId: item.userId ?? "",
      topic: item.topic,
      classification: item.classification,
      detail: item.detail,
      context: item.context ?? "",
      status: item.status,
      effectiveDate: item.effectiveDate,
    });
    setMessage("");
  }
  async function save() {
    setBusy(true);
    setMessage("");
    const response = await fetch(editId ? `/api/v1/preferences/${editId}` : "/api/v1/preferences", {
      method: editId ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, userId: form.userId || null, context: form.context || null }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return setMessage(body.error || "Could not save the preference.");
    setForm(empty(timeZone));
    setEditId(null);
    setMessage("Preference saved and available to meal planning.");
    router.refresh();
  }
  async function supersede(id: string) {
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/v1/preferences/${id}`, { method: "DELETE" });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return setMessage(body.error || "Could not supersede the preference.");
    setMessage("Preference superseded; it remains in history but no longer guides planning.");
    router.refresh();
  }
  return (
    <div className="preference-manager">
      <div className="preference-filters">
        <label>
          Person
          <select value={person} onChange={(event) => setPerson(event.target.value)}>
            <option value="all">Everyone</option>
            <option value="household">Household rules</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="current">Current</option>
            <option value="active">Active</option>
            <option value="contextual">Contextual</option>
            <option value="superseded">Superseded</option>
            <option value="all">All</option>
          </select>
        </label>
        <label>
          Search
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="work lunch, meal size…"
          />
        </label>
      </div>
      <div className="preference-list">
        {filtered.map((item) => (
          <article key={item.id} className={item.status}>
            <header>
              <span>
                <strong>{item.displayName ?? "Household"}</strong>
                <small>
                  {item.topic} · {item.classification.replaceAll("_", " ")}
                </small>
              </span>
              <span className={`status-chip ${item.status === "superseded" ? "warning" : "ready"}`}>
                {item.status}
              </span>
            </header>
            <p>{item.detail}</p>
            {item.context && <em>Context: {item.context}</em>}
            <small>Effective {item.effectiveDate}</small>
            <div className="form-actions">
              <button className="secondary-button" disabled={busy} onClick={() => edit(item)}>
                Edit
              </button>
              {item.status !== "superseded" && (
                <button className="danger-link" disabled={busy} onClick={() => supersede(item.id)}>
                  Supersede
                </button>
              )}
            </div>
          </article>
        ))}
        {!filtered.length && <p className="empty-state">No preferences match these filters.</p>}
      </div>
      <section className="preference-editor">
        <h3>{editId ? "Edit preference" : "Add a planning preference"}</h3>
        <div className="form-grid">
          <label>
            Applies to
            <select
              value={form.userId}
              onChange={(event) =>
                setForm((current) => ({ ...current, userId: event.target.value }))
              }
            >
              <option value="">Household</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Classification
            <select
              value={form.classification}
              onChange={(event) =>
                setForm((current) => ({ ...current, classification: event.target.value }))
              }
            >
              {classifications.map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="span-two">
            Topic
            <input
              value={form.topic}
              onChange={(event) =>
                setForm((current) => ({ ...current, topic: event.target.value }))
              }
              placeholder="Packed work lunches"
            />
          </label>
          <label className="span-two">
            Rule or preference
            <textarea
              value={form.detail}
              onChange={(event) =>
                setForm((current) => ({ ...current, detail: event.target.value }))
              }
              placeholder="This person needs low-aroma food in packed work lunches."
            />
          </label>
          <label className="span-two">
            Context
            <textarea
              value={form.context}
              onChange={(event) =>
                setForm((current) => ({ ...current, context: event.target.value }))
              }
              placeholder="Weekday lunch taken to work; does not apply at home."
            />
          </label>
          <label>
            Status
            <select
              value={form.status}
              onChange={(event) =>
                setForm((current) => ({ ...current, status: event.target.value }))
              }
            >
              <option value="active">Active everywhere applicable</option>
              <option value="contextual">Context-specific</option>
              <option value="superseded">Superseded/history</option>
            </select>
          </label>
          <label>
            Effective date
            <input
              type="date"
              value={form.effectiveDate}
              onChange={(event) =>
                setForm((current) => ({ ...current, effectiveDate: event.target.value }))
              }
            />
          </label>
        </div>
        <div className="form-actions">
          {editId && (
            <button
              className="secondary-button"
              onClick={() => {
                setEditId(null);
                setForm(empty(timeZone));
              }}
            >
              Cancel
            </button>
          )}
          <button
            className="primary-button"
            disabled={busy || !form.topic.trim() || !form.detail.trim()}
            onClick={save}
          >
            {busy ? "Saving…" : editId ? "Save changes" : "Add preference"}
          </button>
        </div>
        {message && <small>{message}</small>}
      </section>
    </div>
  );
}
