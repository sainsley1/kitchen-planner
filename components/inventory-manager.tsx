"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { InventoryRecord, StorageLocationRecord } from "@/lib/db/queries";
import { formatQuantity } from "@/lib/format";
import {
  COMMON_INVENTORY_CATEGORIES,
  COMMON_INVENTORY_UNITS,
  INVENTORY_PRIORITIES,
  PACKAGE_STATES,
  optionLabel,
} from "@/lib/options";

const blank = {
  ingredient: "",
  brandVariety: "",
  category: "",
  quantity: "",
  unit: "",
  storageLocationId: "",
  storageDetail: "",
  packageState: "unknown",
  bestBefore: "",
  priority: "normal",
  notes: "",
};
type Draft = typeof blank;

const blankBulkValues = {
  category: "",
  unit: "",
  storageLocationId: "",
  storageDetail: "",
  packageState: "unknown",
  bestBefore: "",
  priority: "normal",
  notes: "",
};
type BulkValues = typeof blankBulkValues;
type BulkKey = keyof BulkValues;
const blankBulkEnabled: Record<BulkKey, boolean> = {
  category: false,
  unit: false,
  storageLocationId: false,
  storageDetail: false,
  packageState: false,
  bestBefore: false,
  priority: false,
  notes: false,
};

type FilterOption = { value: string; label: string };

function FilterMenu({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <details className="filter-menu">
      <summary>
        {label}
        {selected.length ? ` (${selected.length})` : ""}
      </summary>
      <div className="filter-panel">
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={() => onToggle(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </details>
  );
}

function BulkField({
  label,
  enabled,
  onToggle,
  children,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`bulk-field ${enabled ? "enabled" : ""}`}>
      <label className="bulk-field-toggle">
        <input type="checkbox" checked={enabled} onChange={onToggle} />
        Change {label.toLowerCase()}
      </label>
      <div aria-disabled={!enabled}>{children}</div>
    </div>
  );
}

function toggleArrayValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

export function InventoryManager({
  items,
  locations,
}: {
  items: InventoryRecord[];
  locations: StorageLocationRecord[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [locationFilters, setLocationFilters] = useState<string[]>([]);
  const [categoryFilters, setCategoryFilters] = useState<string[]>([]);
  const [priorityFilters, setPriorityFilters] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [bulkEditing, setBulkEditing] = useState(false);
  const [bulkValues, setBulkValues] = useState<BulkValues>(blankBulkValues);
  const [bulkEnabled, setBulkEnabled] = useState<Record<BulkKey, boolean>>(blankBulkEnabled);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const itemCategories = useMemo(
    () =>
      [...new Set(items.map((item) => item.category))].sort((left, right) =>
        left.localeCompare(right, "en-CA"),
      ),
    [items],
  );
  const categories = useMemo(
    () =>
      [...new Set([...COMMON_INVENTORY_CATEGORIES, ...itemCategories])].sort((left, right) =>
        left.localeCompare(right, "en-CA"),
      ),
    [itemCategories],
  );
  const units = useMemo(
    () =>
      [
        ...new Set([
          ...COMMON_INVENTORY_UNITS,
          ...items.map((item) => item.unit).filter((value): value is string => Boolean(value)),
        ]),
      ].sort((left, right) => left.localeCompare(right, "en-CA")),
    [items],
  );
  const locationOptions = useMemo<FilterOption[]>(
    () => [
      { value: "__none", label: "No location" },
      ...locations.map((location) => ({
        value: location.id,
        label: `${location.name}${location.detail ? ` · ${location.detail}` : ""}`,
      })),
    ],
    [locations],
  );

  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    return items.filter((item) => {
      const matchesSearch =
        !search ||
        `${item.ingredient} ${item.brandVariety ?? ""} ${item.category} ${item.locationName ?? ""} ${item.storageDetail ?? ""}`
          .toLowerCase()
          .includes(search);
      const matchesLocation =
        !locationFilters.length || locationFilters.includes(item.storageLocationId ?? "__none");
      const matchesCategory = !categoryFilters.length || categoryFilters.includes(item.category);
      const matchesPriority = !priorityFilters.length || priorityFilters.includes(item.priority);
      return matchesSearch && matchesLocation && matchesCategory && matchesPriority;
    });
  }, [categoryFilters, items, locationFilters, priorityFilters, query]);

  useEffect(() => {
    const active = new Set(items.map((item) => item.id));
    setSelected((current) => {
      const next = new Set([...current].filter((id) => active.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [items]);

  function change<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function changeBulk<K extends BulkKey>(key: K, value: BulkValues[K]) {
    setBulkValues((current) => ({ ...current, [key]: value }));
  }

  function toggleBulk(key: BulkKey) {
    setBulkEnabled((current) => ({ ...current, [key]: !current[key] }));
  }

  function startNew() {
    setEditing("new");
    setBulkEditing(false);
    setDraft(blank);
    setError("");
    setMessage("");
  }

  function startEdit(item: InventoryRecord) {
    setEditing(item.id);
    setBulkEditing(false);
    setDraft({
      ingredient: item.ingredient,
      brandVariety: item.brandVariety ?? "",
      category: item.category,
      quantity: formatQuantity(item.quantity),
      unit: item.unit ?? "",
      storageLocationId: item.storageLocationId ?? "",
      storageDetail: item.storageDetail ?? "",
      packageState: item.packageState,
      bestBefore: item.bestBefore ?? "",
      priority: item.priority,
      notes: item.notes ?? "",
    });
    setError("");
    setMessage("");
  }

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleVisible() {
    const allVisibleSelected = visible.length > 0 && visible.every((item) => selected.has(item.id));
    setSelected((current) => {
      const next = new Set(current);
      for (const item of visible) {
        if (allVisibleSelected) next.delete(item.id);
        else next.add(item.id);
      }
      return next;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError("");
    setMessage("");
    const isNew = editing === "new";
    let addToShopping = false;
    if (!isNew) {
      const original = items.find((item) => item.id === editing);
      const nextQuantity = draft.quantity === "" ? null : Number(draft.quantity);
      if (original?.quantity != null && Number(original.quantity) > 0 && nextQuantity === 0) {
        addToShopping = window.confirm(
          `${original.ingredient} will reach zero. Add it to the shopping list?`,
        );
      }
    }
    const endpoint = isNew
      ? "/api/v1/inventory"
      : `/api/v1/inventory/${editing}?addToShopping=${addToShopping}`;
    const response = await fetch(endpoint, {
      method: isNew ? "POST" : "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return setError(body.error || "Inventory update failed.");
    setEditing(null);
    setMessage(
      addToShopping ? "Inventory updated and shopping list checked." : "Inventory updated.",
    );
    router.refresh();
  }

  async function consume(item: InventoryRecord) {
    const entered = window.prompt(
      `How many ${item.unit ?? "units"} of ${item.ingredient} did you use?`,
    );
    if (!entered) return;
    const amount = Number(entered);
    if (!Number.isFinite(amount) || amount <= 0) return window.alert("Enter a positive number.");
    const current = Number(item.quantity);
    const addToShopping =
      Number.isFinite(current) && Math.abs(current - amount) < 0.000_001
        ? window.confirm(`${item.ingredient} will reach zero. Add it to the shopping list?`)
        : false;
    const response = await fetch(`/api/v1/inventory/${item.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "consume", amount, addToShopping }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return window.alert(body.error || "Could not consume item.");
    setMessage(
      addToShopping ? "Item used and added to the shopping list." : "Inventory quantity updated.",
    );
    router.refresh();
  }

  async function archive(item: InventoryRecord) {
    if (
      !window.confirm(
        `Remove ${item.ingredient} from active inventory? The audit record will remain.`,
      )
    )
      return;
    const addToShopping = window.confirm(
      `Add ${item.ingredient} to the shopping list as part of this removal?`,
    );
    const response = await fetch(`/api/v1/inventory/${item.id}?addToShopping=${addToShopping}`, {
      method: "DELETE",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return window.alert(body.error || "Could not remove item.");
    if (editing === item.id) setEditing(null);
    setSelected((current) => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
    setMessage(addToShopping ? "Item removed and shopping list checked." : "Item removed.");
    router.refresh();
  }

  async function submitBulk(event: FormEvent) {
    event.preventDefault();
    const patch: Record<string, unknown> = {};
    if (bulkEnabled.category) {
      if (!bulkValues.category.trim()) return setError("Choose a category for the selected items.");
      patch.category = bulkValues.category.trim();
    }
    if (bulkEnabled.unit) patch.unit = bulkValues.unit.trim() || null;
    if (bulkEnabled.storageLocationId) {
      patch.storageLocationId = bulkValues.storageLocationId || null;
      const location = locations.find((entry) => entry.id === bulkValues.storageLocationId);
      if (!bulkEnabled.storageDetail) patch.storageDetail = location?.detail ?? null;
    }
    if (bulkEnabled.storageDetail) patch.storageDetail = bulkValues.storageDetail.trim() || null;
    if (bulkEnabled.packageState) patch.packageState = bulkValues.packageState;
    if (bulkEnabled.bestBefore) patch.bestBefore = bulkValues.bestBefore || null;
    if (bulkEnabled.priority) patch.priority = bulkValues.priority;
    if (bulkEnabled.notes) patch.notes = bulkValues.notes.trim() || null;
    if (!Object.keys(patch).length) return setError("Choose at least one field to change.");

    setBusy(true);
    setError("");
    const response = await fetch("/api/v1/inventory/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "update", ids: [...selected], patch }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return setError(body.error || "Bulk inventory update failed.");
    setMessage(`Updated ${body.count} selected item${body.count === 1 ? "" : "s"}.`);
    setBulkEditing(false);
    setSelected(new Set());
    setBulkEnabled(blankBulkEnabled);
    setBulkValues(blankBulkValues);
    router.refresh();
  }

  async function archiveSelected() {
    const count = selected.size;
    if (
      !count ||
      !window.confirm(
        `Remove ${count} selected item${count === 1 ? "" : "s"} from active inventory?`,
      )
    )
      return;
    const addToShopping = window.confirm(
      `Add the selected item${count === 1 ? "" : "s"} to the shopping list as part of this removal?`,
    );
    setBusy(true);
    setError("");
    const response = await fetch("/api/v1/inventory/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "archive", ids: [...selected], addToShopping }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return setError(body.error || "Bulk inventory removal failed.");
    setMessage(
      `Removed ${body.count} item${body.count === 1 ? "" : "s"}${addToShopping ? " and checked the shopping list" : ""}.`,
    );
    setSelected(new Set());
    setBulkEditing(false);
    router.refresh();
  }

  const form = (
    <form className="entity-form inventory-form" onSubmit={submit}>
      <div className="form-grid">
        <label>
          Ingredient
          <input
            required
            maxLength={200}
            placeholder="e.g. Chickpeas"
            value={draft.ingredient}
            onChange={(event) => change("ingredient", event.target.value)}
          />
        </label>
        <label>
          Brand / variety
          <input
            maxLength={500}
            placeholder="Optional"
            value={draft.brandVariety}
            onChange={(event) => change("brandVariety", event.target.value)}
          />
        </label>
        <label>
          Category
          <input
            required
            list="inventory-category-options"
            maxLength={100}
            placeholder="Choose or type a category"
            value={draft.category}
            onChange={(event) => change("category", event.target.value)}
          />
        </label>
        <label>
          Quantity
          <input
            inputMode="decimal"
            pattern="(?:[0-9]+(?:\.[0-9]{0,3})?|\.[0-9]{1,3})"
            title="Use a positive number with up to three decimal places"
            placeholder="Optional"
            value={draft.quantity}
            onChange={(event) => change("quantity", event.target.value)}
          />
        </label>
        <label>
          Unit
          <input
            list="inventory-unit-options"
            maxLength={100}
            placeholder="e.g. can, g, bunch"
            value={draft.unit}
            onChange={(event) => change("unit", event.target.value)}
          />
        </label>
        <label>
          Location
          <select
            value={draft.storageLocationId}
            onChange={(event) => {
              const chosen = locations.find((location) => location.id === event.target.value);
              change("storageLocationId", event.target.value);
              change("storageDetail", chosen?.detail ?? "");
            }}
          >
            <option value="">No location / unknown</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
                {location.detail ? ` · ${location.detail}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Storage detail
          <input
            maxLength={500}
            placeholder="Shelf, drawer, or bin"
            value={draft.storageDetail}
            onChange={(event) => change("storageDetail", event.target.value)}
          />
        </label>
        <label>
          Package state
          <select
            value={draft.packageState}
            onChange={(event) => change("packageState", event.target.value)}
          >
            {PACKAGE_STATES.map((value) => (
              <option key={value} value={value}>
                {optionLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select
            value={draft.priority}
            onChange={(event) => change("priority", event.target.value)}
          >
            {INVENTORY_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {optionLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Best before
          <input
            type="date"
            value={draft.bestBefore}
            onChange={(event) => change("bestBefore", event.target.value)}
          />
        </label>
        <label className="span-two">
          Notes
          <textarea
            maxLength={500}
            placeholder="Optional details that will help later"
            value={draft.notes}
            onChange={(event) => change("notes", event.target.value)}
          />
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="secondary-button" onClick={() => setEditing(null)}>
          Cancel
        </button>
        <button className="primary-button" disabled={busy}>
          {busy ? "Saving…" : "Save item"}
        </button>
      </div>
    </form>
  );

  return (
    <>
      <datalist id="inventory-category-options">
        {categories.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>
      <datalist id="inventory-unit-options">
        {units.map((unit) => (
          <option key={unit} value={unit} />
        ))}
      </datalist>

      <div className="inventory-toolbar-advanced">
        <input
          aria-label="Search inventory"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search ingredients, categories, or locations"
        />
        <div className="filter-menus">
          <FilterMenu
            label="Location"
            options={locationOptions}
            selected={locationFilters}
            onToggle={(value) => setLocationFilters((current) => toggleArrayValue(current, value))}
          />
          <FilterMenu
            label="Category"
            options={itemCategories.map((category) => ({ value: category, label: category }))}
            selected={categoryFilters}
            onToggle={(value) => setCategoryFilters((current) => toggleArrayValue(current, value))}
          />
          <FilterMenu
            label="Priority"
            options={INVENTORY_PRIORITIES.map((priority) => ({
              value: priority,
              label: optionLabel(priority),
            }))}
            selected={priorityFilters}
            onToggle={(value) => setPriorityFilters((current) => toggleArrayValue(current, value))}
          />
          {locationFilters.length + categoryFilters.length + priorityFilters.length > 0 && (
            <button
              type="button"
              className="clear-filter"
              onClick={() => {
                setLocationFilters([]);
                setCategoryFilters([]);
                setPriorityFilters([]);
              }}
            >
              Clear filters
            </button>
          )}
        </div>
        <button className="primary-button" onClick={startNew}>
          Add inventory item
        </button>
      </div>

      <div className="inventory-result-bar">
        <span>
          {visible.length} of {items.length} items shown
        </span>
        <button
          type="button"
          className="secondary-button"
          disabled={!visible.length}
          onClick={toggleVisible}
        >
          {visible.length > 0 && visible.every((item) => selected.has(item.id))
            ? "Unselect shown"
            : "Select all shown"}
        </button>
      </div>

      {message && <p className="form-success">{message}</p>}
      {error && editing == null && !bulkEditing && <p className="form-error">{error}</p>}

      {selected.size > 0 && (
        <div className="selection-bar">
          <strong>{selected.size} selected</strong>
          <span>Changes apply to every selected item.</span>
          <div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setBulkEditing(!bulkEditing);
                setEditing(null);
                setError("");
              }}
            >
              {bulkEditing ? "Close bulk edit" : "Edit selected"}
            </button>
            <button
              type="button"
              className="danger-button"
              disabled={busy}
              onClick={archiveSelected}
            >
              Remove selected
            </button>
            <button
              type="button"
              className="clear-filter"
              onClick={() => {
                setSelected(new Set());
                setBulkEditing(false);
              }}
            >
              Clear selection
            </button>
          </div>
        </div>
      )}

      {bulkEditing && selected.size > 0 && (
        <form className="entity-form bulk-editor" onSubmit={submitBulk}>
          <header>
            <div>
              <h2>Bulk edit {selected.size} items</h2>
              <p>
                Check only the fields you want to replace. Unchecked fields stay exactly as they
                are.
              </p>
            </div>
          </header>
          <div className="bulk-grid">
            <BulkField
              label="Category"
              enabled={bulkEnabled.category}
              onToggle={() => toggleBulk("category")}
            >
              <input
                disabled={!bulkEnabled.category}
                list="inventory-category-options"
                value={bulkValues.category}
                onChange={(event) => changeBulk("category", event.target.value)}
              />
            </BulkField>
            <BulkField label="Unit" enabled={bulkEnabled.unit} onToggle={() => toggleBulk("unit")}>
              <input
                disabled={!bulkEnabled.unit}
                list="inventory-unit-options"
                value={bulkValues.unit}
                onChange={(event) => changeBulk("unit", event.target.value)}
              />
            </BulkField>
            <BulkField
              label="Location"
              enabled={bulkEnabled.storageLocationId}
              onToggle={() => toggleBulk("storageLocationId")}
            >
              <select
                disabled={!bulkEnabled.storageLocationId}
                value={bulkValues.storageLocationId}
                onChange={(event) => changeBulk("storageLocationId", event.target.value)}
              >
                <option value="">No location / unknown</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                    {location.detail ? ` · ${location.detail}` : ""}
                  </option>
                ))}
              </select>
            </BulkField>
            <BulkField
              label="Storage detail"
              enabled={bulkEnabled.storageDetail}
              onToggle={() => toggleBulk("storageDetail")}
            >
              <input
                disabled={!bulkEnabled.storageDetail}
                value={bulkValues.storageDetail}
                onChange={(event) => changeBulk("storageDetail", event.target.value)}
              />
            </BulkField>
            <BulkField
              label="Package state"
              enabled={bulkEnabled.packageState}
              onToggle={() => toggleBulk("packageState")}
            >
              <select
                disabled={!bulkEnabled.packageState}
                value={bulkValues.packageState}
                onChange={(event) => changeBulk("packageState", event.target.value)}
              >
                {PACKAGE_STATES.map((value) => (
                  <option key={value} value={value}>
                    {optionLabel(value)}
                  </option>
                ))}
              </select>
            </BulkField>
            <BulkField
              label="Best before"
              enabled={bulkEnabled.bestBefore}
              onToggle={() => toggleBulk("bestBefore")}
            >
              <input
                disabled={!bulkEnabled.bestBefore}
                type="date"
                value={bulkValues.bestBefore}
                onChange={(event) => changeBulk("bestBefore", event.target.value)}
              />
            </BulkField>
            <BulkField
              label="Priority"
              enabled={bulkEnabled.priority}
              onToggle={() => toggleBulk("priority")}
            >
              <select
                disabled={!bulkEnabled.priority}
                value={bulkValues.priority}
                onChange={(event) => changeBulk("priority", event.target.value)}
              >
                {INVENTORY_PRIORITIES.map((value) => (
                  <option key={value} value={value}>
                    {optionLabel(value)}
                  </option>
                ))}
              </select>
            </BulkField>
            <BulkField
              label="Notes"
              enabled={bulkEnabled.notes}
              onToggle={() => toggleBulk("notes")}
            >
              <input
                disabled={!bulkEnabled.notes}
                value={bulkValues.notes}
                onChange={(event) => changeBulk("notes", event.target.value)}
              />
            </BulkField>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setBulkEditing(false)}
            >
              Cancel
            </button>
            <button className="primary-button" disabled={busy}>
              {busy ? "Applying…" : `Apply to ${selected.size} items`}
            </button>
          </div>
        </form>
      )}

      {editing === "new" && (
        <div className="inline-editor">
          <h2>Add inventory item</h2>
          <p className="muted">
            Required fields are marked by the browser. Constrained fields use selectable options.
          </p>
          {form}
        </div>
      )}

      <div className="inventory-list">
        {visible.map((item) => (
          <article
            className={`inventory-row inventory-edit-row ${selected.has(item.id) ? "selected" : ""}`}
            key={item.id}
          >
            <label className="inventory-select" title={`Select ${item.ingredient}`}>
              <input
                type="checkbox"
                checked={selected.has(item.id)}
                onChange={() => toggleSelected(item.id)}
                aria-label={`Select ${item.ingredient}`}
              />
            </label>
            <div>
              <strong>{item.ingredient}</strong>
              <span>{item.brandVariety || item.category}</span>
            </div>
            <div>
              <strong>
                {item.quantity == null ? "?" : formatQuantity(item.quantity)} {item.unit ?? ""}
              </strong>
              <span>
                {item.locationName ?? "Unknown"}
                {item.storageDetail ? ` · ${item.storageDetail}` : ""}
              </span>
            </div>
            <span className={`priority priority-${item.priority.replaceAll("_", "-")}`}>
              {optionLabel(item.priority)}
            </span>
            <div className="row-actions">
              <button onClick={() => startEdit(item)}>Edit</button>
              <button onClick={() => consume(item)} disabled={item.quantity == null}>
                Use
              </button>
              <button className="danger-link" onClick={() => archive(item)}>
                Remove
              </button>
            </div>
            {editing === item.id && (
              <div className="inline-editor row-editor">
                <h2>Edit {item.ingredient}</h2>
                {form}
              </div>
            )}
          </article>
        ))}
      </div>
      {!visible.length && <p className="empty-state">No inventory items match these filters.</p>}
    </>
  );
}
