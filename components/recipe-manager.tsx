"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { RecipeInput } from "@/lib/ai/contracts";
import type { HouseholdUserRecord, RecipeRecord } from "@/lib/db/queries";
import { formatQuantity } from "@/lib/format";
import { householdSaturdayKey } from "@/lib/datetime";
import { MEAL_TYPES, optionLabel } from "@/lib/options";

const sourceTypes = ["household", "external_link", "imported_text", "imported_file"] as const;
function emptyRecipe(): RecipeInput {
  return {
    title: "",
    sourceType: "household",
    sourceUrl: null,
    description: null,
    cuisine: null,
    mealTypes: [],
    plannedYield: null,
    servings: null,
    prepMinutes: null,
    cookMinutes: null,
    ingredients: [],
    instructions: [],
    tags: [],
    notes: null,
    favorite: false,
    recipeStatus: "proven",
    freezerFriendly: false,
    leftoverFriendly: false,
    packedLunchFriendly: false,
  };
}
function fromRecord(item: RecipeRecord): RecipeInput {
  return {
    title: item.title,
    sourceType: item.sourceType as RecipeInput["sourceType"],
    sourceUrl: item.sourceUrl,
    description: item.description,
    cuisine: item.cuisine,
    mealTypes: item.mealTypes as RecipeInput["mealTypes"],
    plannedYield: item.plannedYield,
    servings: item.servings,
    prepMinutes: item.prepMinutes,
    cookMinutes: item.cookMinutes,
    ingredients: item.ingredients,
    instructions: item.instructions,
    tags: item.tags,
    notes: item.notes,
    favorite: item.favorite,
    recipeStatus: item.recipeStatus as RecipeInput["recipeStatus"],
    freezerFriendly: item.freezerFriendly,
    leftoverFriendly: item.leftoverFriendly,
    packedLunchFriendly: item.packedLunchFriendly,
  };
}
async function jsonCall(path: string, method: string, body?: unknown) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || "Recipe action failed");
  return value;
}

export function RecipeManager({
  items,
  users,
  timeZone,
  aiConfigured,
}: {
  items: RecipeRecord[];
  users: HouseholdUserRecord[];
  timeZone: string;
  aiConfigured: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [cuisine, setCuisine] = useState("all");
  const [status, setStatus] = useState("current");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RecipeInput>(emptyRecipe());
  const [showEditor, setShowEditor] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(householdSaturdayKey(new Date(), timeZone));
  const [itemType, setItemType] = useState("dinner");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const cuisines = useMemo(
    () =>
      [
        ...new Set(
          items.map((item) => item.cuisine).filter((value): value is string => Boolean(value)),
        ),
      ].sort(),
    [items],
  );
  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          (cuisine === "all" || item.cuisine === cuisine) &&
          (status === "all" ||
            (status === "current"
              ? item.recipeStatus !== "avoid"
              : item.recipeStatus === status)) &&
          (favoriteOnly ? item.favorite : true) &&
          `${item.title} ${item.description ?? ""} ${item.cuisine ?? ""} ${item.tags.join(" ")} ${item.ingredients.map((entry) => entry.item).join(" ")}`
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()),
      ),
    [items, cuisine, status, favoriteOnly, query],
  );
  function reset() {
    setEditingId(null);
    setForm(emptyRecipe());
    setWarnings([]);
    setShowEditor(false);
  }
  function edit(item: RecipeRecord) {
    setEditingId(item.id);
    setForm(fromRecord(item));
    setWarnings([]);
    setShowEditor(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function ingredient(index: number, patch: Partial<RecipeInput["ingredients"][number]>) {
    setForm((current) => ({
      ...current,
      ingredients: current.ingredients.map((entry, i) =>
        i === index ? { ...entry, ...patch } : entry,
      ),
    }));
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await jsonCall(
        editingId ? `/api/v1/recipes/${editingId}` : "/api/v1/recipes",
        editingId ? "PATCH" : "POST",
        form,
      );
      setMessage(editingId ? "Recipe updated." : "Recipe added to the household cookbook.");
      reset();
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Recipe could not be saved");
    } finally {
      setBusy(false);
    }
  }
  async function importDraft(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = new FormData();
      data.set("text", importText);
      data.set("sourceUrl", importUrl);
      if (importFile) data.set("file", importFile);
      const response = await fetch("/api/v1/recipes/import", { method: "POST", body: data });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Recipe import failed");
      const { extractionWarnings, ...draft } = body.draft;
      setForm(draft);
      setWarnings(extractionWarnings);
      setEditingId(null);
      setShowEditor(true);
      setShowImport(false);
      setMessage(`Recipe organized with ${body.modelTier}. Review it before saving.`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Recipe import failed");
    } finally {
      setBusy(false);
    }
  }
  async function archive(item: RecipeRecord) {
    if (!window.confirm(`Archive ${item.title}? Existing meal history will be retained.`)) return;
    setBusy(true);
    setError("");
    try {
      await jsonCall(`/api/v1/recipes/${item.id}`, "DELETE");
      setMessage("Recipe archived.");
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Recipe could not be archived");
    } finally {
      setBusy(false);
    }
  }
  async function addUnscheduled(id: string) {
    setBusy(true);
    setError("");
    try {
      await jsonCall(`/api/v1/recipes/${id}/unscheduled`, "POST", {
        weekStart,
        itemType,
        assignedUserId: assignedUserId || null,
        notes: null,
      });
      setScheduleId(null);
      setMessage("Recipe added to Unscheduled items.");
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Recipe could not be added");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="recipe-library">
      <section className="section-card recipe-library-actions">
        <header>
          <div>
            <h2>Household cookbook</h2>
            <p className="muted">
              Manual records cost no AI tokens. Imported material is always reviewed before it
              becomes planning evidence.
            </p>
          </div>
          <div className="form-actions">
            <button
              className="secondary-button"
              disabled={!aiConfigured || busy}
              onClick={() => setShowImport((value) => !value)}
            >
              Import with AI
            </button>
            <button
              className="primary-button"
              onClick={() => {
                setForm(emptyRecipe());
                setEditingId(null);
                setWarnings([]);
                setShowEditor(true);
              }}
            >
              Add recipe
            </button>
          </div>
        </header>
        {showImport && (
          <form className="entity-form" onSubmit={importDraft}>
            <div className="form-grid">
              <label className="span-two">
                Paste recipe text
                <textarea
                  value={importText}
                  onChange={(event) => setImportText(event.target.value)}
                  placeholder="Paste your recipe, notes or transcription…"
                />
              </label>
              <label className="span-two">
                Public recipe URL
                <input
                  type="url"
                  value={importUrl}
                  onChange={(event) => setImportUrl(event.target.value)}
                  placeholder="https://…"
                />
              </label>
              <div className="span-two">
                <label style={{ display: "block", marginBottom: "6px" }}>Recipe image or PDF</label>
                <div
                  style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}
                >
                  <label
                    className="secondary-button"
                    style={{
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    📷 Take Photo
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      style={{ display: "none" }}
                      onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  <label
                    className="secondary-button"
                    style={{
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    📁 Choose Photo / PDF
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,application/pdf"
                      style={{ display: "none" }}
                      onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  {importFile && (
                    <span
                      style={{
                        fontSize: "13px",
                        color: "var(--ink-soft)",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      ✓ {importFile.name} ({(importFile.size / 1024).toFixed(0)} KB)
                      <button
                        type="button"
                        style={{
                          border: 0,
                          background: "none",
                          color: "var(--danger)",
                          cursor: "pointer",
                          padding: 0,
                        }}
                        onClick={() => setImportFile(null)}
                      >
                        ✕
                      </button>
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowImport(false)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={busy || (!importText.trim() && !importUrl.trim() && !importFile)}
              >
                {busy ? "Organizing…" : "Create review draft"}
              </button>
            </div>
          </form>
        )}
        {showEditor && (
          <form className="entity-form recipe-editor" onSubmit={save}>
            <h3>{editingId ? "Edit recipe" : "Review and save recipe"}</h3>
            {warnings.length > 0 && (
              <div className="plan-issues">
                <strong>Extraction needs review</strong>
                <ul>
                  {warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="form-grid">
              <label className="span-two">
                Title
                <input
                  required
                  value={form.title}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, title: event.target.value }))
                  }
                />
              </label>
              <label>
                Source type
                <select
                  value={form.sourceType}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      sourceType: event.target.value as RecipeInput["sourceType"],
                    }))
                  }
                >
                  {sourceTypes.map((value) => (
                    <option key={value} value={value}>
                      {optionLabel(value)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Recipe status
                <select
                  value={form.recipeStatus}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      recipeStatus: event.target.value as RecipeInput["recipeStatus"],
                    }))
                  }
                >
                  <option value="proven">Proven</option>
                  <option value="experimental">Experimental</option>
                  <option value="avoid">Do not suggest</option>
                </select>
              </label>
              <label className="span-two">
                Source URL
                <input
                  type="url"
                  value={form.sourceUrl ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, sourceUrl: event.target.value || null }))
                  }
                />
              </label>
              <label>
                Cuisine
                <input
                  value={form.cuisine ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, cuisine: event.target.value || null }))
                  }
                />
              </label>
              <label>
                Yield
                <input
                  value={form.plannedYield ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, plannedYield: event.target.value || null }))
                  }
                />
              </label>
              <label>
                Servings
                <input
                  type="number"
                  min="1"
                  value={form.servings ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      servings: event.target.value ? Number(event.target.value) : null,
                    }))
                  }
                />
              </label>
              <label>
                Prep minutes
                <input
                  type="number"
                  min="0"
                  value={form.prepMinutes ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      prepMinutes: event.target.value ? Number(event.target.value) : null,
                    }))
                  }
                />
              </label>
              <label>
                Cook minutes
                <input
                  type="number"
                  min="0"
                  value={form.cookMinutes ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      cookMinutes: event.target.value ? Number(event.target.value) : null,
                    }))
                  }
                />
              </label>
              <label className="span-two">
                Description
                <textarea
                  value={form.description ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, description: event.target.value || null }))
                  }
                />
              </label>
              <fieldset className="span-two checkbox-group">
                <legend>Meal types</legend>
                {MEAL_TYPES.map((type) => (
                  <label className="checkbox-label" key={type}>
                    <input
                      type="checkbox"
                      checked={form.mealTypes.includes(type)}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          mealTypes: event.target.checked
                            ? [...current.mealTypes, type]
                            : current.mealTypes.filter((entry) => entry !== type),
                        }))
                      }
                    />
                    {optionLabel(type)}
                  </label>
                ))}
              </fieldset>
              <label className="span-two">
                Tags, comma-separated
                <input
                  value={form.tags.join(", ")}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      tags: event.target.value
                        .split(",")
                        .map((tag) => tag.trim())
                        .filter(Boolean),
                    }))
                  }
                />
              </label>
            </div>
            <div className="recipe-editor-list">
              <header>
                <h4>Ingredients</h4>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      ingredients: [
                        ...current.ingredients,
                        {
                          item: "",
                          quantity: null,
                          unit: null,
                          preparation: null,
                          optional: false,
                          notes: null,
                        },
                      ],
                    }))
                  }
                >
                  Add ingredient
                </button>
              </header>
              {form.ingredients.map((entry, index) => (
                <div className="recipe-ingredient-edit" key={index}>
                  <input
                    aria-label="Ingredient"
                    required
                    value={entry.item}
                    onChange={(event) => ingredient(index, { item: event.target.value })}
                    placeholder="Ingredient"
                  />
                  <input
                    aria-label="Quantity"
                    type="number"
                    min="0"
                    step="0.001"
                    value={entry.quantity ?? ""}
                    onChange={(event) =>
                      ingredient(index, {
                        quantity: event.target.value ? Number(event.target.value) : null,
                      })
                    }
                  />
                  <input
                    aria-label="Unit"
                    value={entry.unit ?? ""}
                    onChange={(event) => ingredient(index, { unit: event.target.value || null })}
                    placeholder="unit"
                  />
                  <input
                    aria-label="Preparation"
                    value={entry.preparation ?? ""}
                    onChange={(event) =>
                      ingredient(index, { preparation: event.target.value || null })
                    }
                    placeholder="diced, divided…"
                  />
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={entry.optional}
                      onChange={(event) => ingredient(index, { optional: event.target.checked })}
                    />
                    Optional
                  </label>
                  <button
                    type="button"
                    className="danger-link"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        ingredients: current.ingredients.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="recipe-editor-list">
              <header>
                <h4>Instructions</h4>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      instructions: [...current.instructions, ""],
                    }))
                  }
                >
                  Add step
                </button>
              </header>
              {form.instructions.map((step, index) => (
                <div className="recipe-step-edit" key={index}>
                  <strong>{index + 1}</strong>
                  <textarea
                    required
                    value={step}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        instructions: current.instructions.map((value, i) =>
                          i === index ? event.target.value : value,
                        ),
                      }))
                    }
                  />
                  <button
                    type="button"
                    className="danger-link"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        instructions: current.instructions.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="form-grid">
              <label className="span-two">
                Household notes
                <textarea
                  value={form.notes ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, notes: event.target.value || null }))
                  }
                />
              </label>
              <fieldset className="span-two checkbox-group">
                <legend>Planning signals</legend>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.favorite}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, favorite: event.target.checked }))
                    }
                  />
                  Favourite
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.freezerFriendly}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, freezerFriendly: event.target.checked }))
                    }
                  />
                  Freezer-friendly
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.leftoverFriendly}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, leftoverFriendly: event.target.checked }))
                    }
                  />
                  Good leftovers
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.packedLunchFriendly}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        packedLunchFriendly: event.target.checked,
                      }))
                    }
                  />
                  Packed-lunch friendly
                </label>
              </fieldset>
            </div>
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={reset}>
                Cancel
              </button>
              <button className="primary-button" disabled={busy}>
                {busy ? "Saving…" : "Save recipe"}
              </button>
            </div>
          </form>
        )}
        {error && <p className="form-error">{error}</p>}
        {message && <p className="form-success">{message}</p>}
      </section>
      <section className="section-card">
        <header>
          <div>
            <h2>Recipe repository</h2>
            <p className="muted">
              {filtered.length} of {items.length} active recipes
            </p>
          </div>
        </header>
        <div className="recipe-filters">
          <label>
            Search
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="dish, ingredient or tag"
            />
          </label>
          <label>
            Cuisine
            <select value={cuisine} onChange={(event) => setCuisine(event.target.value)}>
              <option value="all">All cuisines</option>
              {cuisines.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="current">Current filter</option>
              <option value="proven">Proven</option>
              <option value="experimental">Experimental</option>
              <option value="avoid">Do not suggest</option>
              <option value="all">All</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={favoriteOnly}
              onChange={(event) => setFavoriteOnly(event.target.checked)}
            />
            Favourites only
          </label>
        </div>
        <div className="recipe-card-grid">
          {filtered.map((item) => (
            <article className="recipe-card" key={item.id}>
              <header>
                <div>
                  <span className="eyebrow">
                    {item.cuisine ?? "Flexible"}
                    {item.favorite ? " · Favourite" : ""}
                  </span>
                  <h3>{item.title}</h3>
                </div>
                <span
                  className={`status-chip ${item.recipeStatus === "avoid" ? "warning" : "ready"}`}
                >
                  {item.recipeStatus}
                </span>
              </header>
              {item.description && <p>{item.description}</p>}
              <div className="recipe-meta">
                <span>
                  {item.plannedYield ??
                    (item.servings ? `${item.servings} servings` : "Yield not recorded")}
                </span>
                {item.prepMinutes != null && <span>{item.prepMinutes} min prep</span>}
                {item.cookMinutes != null && <span>{item.cookMinutes} min cook</span>}
              </div>
              {item.tags.length > 0 && (
                <div className="tag-row">
                  {item.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              )}
              <details>
                <summary>{item.ingredients.length} ingredients</summary>
                <ul className="recipe-ingredients">
                  {item.ingredients.map((entry, index) => (
                    <li key={`${entry.item}-${index}`}>
                      <span>
                        {formatQuantity(entry.quantity)} {entry.unit ?? ""}
                      </span>
                      <strong>{entry.item}</strong>
                      {entry.preparation && <em>{entry.preparation}</em>}
                      {entry.optional && <small>optional</small>}
                    </li>
                  ))}
                </ul>
              </details>
              {item.instructions.length > 0 && (
                <details>
                  <summary>{item.instructions.length} instruction steps</summary>
                  <ol>
                    {item.instructions.map((step, index) => (
                      <li key={index}>{step}</li>
                    ))}
                  </ol>
                </details>
              )}
              {item.sourceUrl && (
                <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                  Open original source ↗
                </a>
              )}
              <div className="recipe-signals">
                {item.freezerFriendly && <span>Freezer</span>}
                {item.leftoverFriendly && <span>Leftovers</span>}
                {item.packedLunchFriendly && <span>Packed lunch</span>}
                {item.feedbackCount > 0 && <span>{item.feedbackCount} feedback</span>}
              </div>
              {item.latestFeedback.length > 0 && (
                <details>
                  <summary>Recent household feedback</summary>
                  {item.latestFeedback.map((feedback, index) => (
                    <blockquote key={index}>
                      <strong>
                        {feedback.person ?? "Household"} · {feedback.rating}
                      </strong>
                      <p>{feedback.feedback}</p>
                    </blockquote>
                  ))}
                </details>
              )}
              <div className="form-actions">
                <button className="secondary-button" onClick={() => edit(item)}>
                  Edit
                </button>
                <button
                  className="secondary-button"
                  onClick={() => setScheduleId(scheduleId === item.id ? null : item.id)}
                >
                  Add to Unscheduled
                </button>
                <button className="danger-link" onClick={() => archive(item)}>
                  Archive
                </button>
              </div>
              {scheduleId === item.id && (
                <div className="recipe-schedule">
                  <label>
                    Week starts
                    <input
                      type="date"
                      value={weekStart}
                      onChange={(event) => setWeekStart(event.target.value)}
                    />
                  </label>
                  <label>
                    Type
                    <select value={itemType} onChange={(event) => setItemType(event.target.value)}>
                      {MEAL_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {optionLabel(type)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    For
                    <select
                      value={assignedUserId}
                      onChange={(event) => setAssignedUserId(event.target.value)}
                    >
                      <option value="">Household</option>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() => addUnscheduled(item.id)}
                  >
                    Add
                  </button>
                </div>
              )}
            </article>
          ))}
          {!filtered.length && <p className="empty-state">No recipes match these filters.</p>}
        </div>
      </section>
    </div>
  );
}
