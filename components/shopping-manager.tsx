"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AiFallbackOffer, type FallbackOffer } from "@/components/ai-fallback-offer";
import type { InventoryRecord, ShoppingRecord, StorageLocationRecord } from "@/lib/db/queries";
import { formatQuantity } from "@/lib/format";
import {
  COMMON_INVENTORY_CATEGORIES,
  COMMON_INVENTORY_UNITS,
  INVENTORY_PRIORITIES,
  PACKAGE_STATES,
  optionLabel,
} from "@/lib/options";

const blankShoppingDraft = {
  item: "",
  category: "",
  quantity: "",
  unit: "",
  notes: "",
};
type ShoppingDraft = typeof blankShoppingDraft;

type RegistrationDraft = {
  action: "register" | "defer";
  category: string;
  quantity: string;
  unit: string;
  storageLocationId: string;
  inventoryEntryId: string;
  storageDetail: string;
  packageState: string;
  priority: string;
  notes: string;
};

const quantityPattern = "(?:[0-9]+(?:\\.[0-9]+)?|\\.[0-9]+)";

export function ShoppingManager({
  initialItems,
  locations,
  inventory,
  aiConfigured,
}: {
  initialItems: ShoppingRecord[];
  locations: StorageLocationRecord[];
  inventory: InventoryRecord[];
  aiConfigured: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<ShoppingDraft>(blankShoppingDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ShoppingDraft>(blankShoppingDraft);
  const [registering, setRegistering] = useState(false);
  const [registrationDrafts, setRegistrationDrafts] = useState<Record<string, RegistrationDraft>>(
    {},
  );
  const [registrationExplanations, setRegistrationExplanations] = useState<Record<string, string>>(
    {},
  );
  const [registrationFallback, setRegistrationFallback] = useState<FallbackOffer | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const purchasedItems = initialItems.filter((entry) => entry.status === "purchased");
  const tripItems = initialItems.filter(
    (entry) => entry.status === "to_buy" || entry.status === "purchased",
  );
  const allTripItemsSelected =
    tripItems.length > 0 && tripItems.every((entry) => entry.status === "purchased");
  const someTripItemsSelected = tripItems.some((entry) => entry.status === "purchased");
  useEffect(() => {
    if (selectAllRef.current)
      selectAllRef.current.indeterminate = someTripItemsSelected && !allTripItemsSelected;
  }, [allTripItemsSelected, someTripItemsSelected]);
  const categories = useMemo(
    () =>
      [
        ...new Set([
          ...COMMON_INVENTORY_CATEGORIES,
          ...initialItems
            .map((entry) => entry.category)
            .filter((value): value is string => Boolean(value)),
        ]),
      ].sort(),
    [initialItems],
  );
  const units = useMemo(
    () =>
      [
        ...new Set([
          ...COMMON_INVENTORY_UNITS,
          ...initialItems
            .map((entry) => entry.unit)
            .filter((value): value is string => Boolean(value)),
        ]),
      ].sort(),
    [initialItems],
  );

  function changeDraft<K extends keyof ShoppingDraft>(key: K, value: ShoppingDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function changeEditDraft<K extends keyof ShoppingDraft>(key: K, value: ShoppingDraft[K]) {
    setEditDraft((current) => ({ ...current, [key]: value }));
  }

  function changeRegistration(id: string, patch: Partial<RegistrationDraft>) {
    setRegistrationDrafts((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));
  }

  async function request(path: string, method: string, body?: unknown) {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Shopping list update failed.");
    return payload;
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await request("/api/v1/shopping", "POST", {
        ...draft,
        quantity: draft.quantity || null,
        status: "to_buy",
      });
      setDraft(blankShoppingDraft);
      setAdding(false);
      setMessage("Shopping item added.");
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not add item.");
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: unknown) {
    setError("");
    try {
      await request(`/api/v1/shopping/${id}`, "PATCH", body);
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Update failed.");
    }
  }

  function startEdit(entry: ShoppingRecord) {
    setEditingId(entry.id);
    setAdding(false);
    setRegistering(false);
    setEditDraft({
      item: entry.item,
      category: entry.category ?? "",
      quantity: formatQuantity(entry.quantity),
      unit: entry.unit ?? "",
      notes: entry.notes ?? "",
    });
    setError("");
    setMessage("");
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingId) return;
    setBusy(true);
    setError("");
    try {
      await request(`/api/v1/shopping/${editingId}`, "PATCH", {
        ...editDraft,
        quantity: editDraft.quantity || null,
      });
      setEditingId(null);
      setMessage("Shopping item updated.");
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError("");
    try {
      await request(`/api/v1/shopping/${id}`, "DELETE");
      if (editingId === id) setEditingId(null);
      setMessage("Shopping item removed.");
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not remove item.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleAllForRegistration() {
    if (!tripItems.length) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await request("/api/v1/shopping/bulk", "POST", {
        ids: tripItems.map((entry) => entry.id),
        status: allTripItemsSelected ? "to_buy" : "purchased",
      });
      setMessage(
        allTripItemsSelected
          ? "Cleared the grocery registration selection."
          : `Selected ${tripItems.length} items for registration.`,
      );
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Could not update the selection.",
      );
    } finally {
      setBusy(false);
    }
  }

  function beginRegistration() {
    const next: Record<string, RegistrationDraft> = {};
    for (const entry of purchasedItems) {
      next[entry.id] = {
        action: "register",
        category: entry.category || "Uncategorised",
        quantity: formatQuantity(entry.quantity) || "1",
        unit: entry.unit ?? "",
        storageLocationId: "",
        inventoryEntryId: entry.inventoryEntryId ?? "",
        storageDetail: "",
        packageState: "sealed",
        priority: "normal",
        notes: "",
      };
    }
    setRegistrationDrafts(next);
    setRegistrationExplanations({});
    setRegistrationFallback(null);
    setRegistering(true);
    setAdding(false);
    setEditingId(null);
    setError("");
    setMessage("");
  }

  async function recommendRegistration(fallbackOfJobId?: string) {
    setBusy(true);
    setError("");
    try {
      const result = await request(
        "/api/v1/ai/grocery-registration",
        "POST",
        fallbackOfJobId
          ? { fallbackOfJobId }
          : { shoppingItemIds: purchasedItems.map((entry) => entry.id) },
      );
      setRegistrationFallback(result.fallback ?? null);
      if (!result.recommendation) {
        setMessage(
          "The initial model could not produce a safe recommendation. Review the reason below and choose whether to retry with the advanced model.",
        );
        return;
      }
      const suggestions = result.recommendation.suggestions as Array<Record<string, unknown>>;
      setRegistrationDrafts((current) => {
        const next = { ...current };
        for (const suggestion of suggestions) {
          const id = String(suggestion.shoppingItemId);
          if (!next[id]) continue;
          next[id] = {
            ...next[id],
            category: String(suggestion.category),
            quantity: formatQuantity(suggestion.quantity as number),
            unit: suggestion.unit == null ? "" : String(suggestion.unit),
            storageLocationId:
              suggestion.storageLocationId == null ? "" : String(suggestion.storageLocationId),
            inventoryEntryId:
              suggestion.inventoryEntryId == null ? "" : String(suggestion.inventoryEntryId),
            storageDetail: suggestion.storageDetail == null ? "" : String(suggestion.storageDetail),
            packageState: String(suggestion.packageState),
            priority: String(suggestion.priority),
            notes: suggestion.notes == null ? "" : String(suggestion.notes),
          };
        }
        return next;
      });
      setRegistrationExplanations(
        Object.fromEntries(
          suggestions.map((suggestion) => [
            String(suggestion.shoppingItemId),
            String(suggestion.explanation),
          ]),
        ),
      );
      const warnings = result.recommendation.warnings as string[];
      setMessage(
        warnings.length
          ? `Recommendations applied for review. ${warnings.join(" ")}`
          : `${result.modelTier === "fallback" ? "Advanced" : result.modelTier === "economy" ? "Economy" : "Primary"} recommendations applied for review.`,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not prepare storage recommendations.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function finishRegistration(event: FormEvent) {
    event.preventDefault();
    const items = purchasedItems.map((entry) => {
      const line = registrationDrafts[entry.id];
      if (line.action === "defer") return { shoppingItemId: entry.id, action: "defer" };
      return {
        shoppingItemId: entry.id,
        action: "register",
        category: line.category,
        quantity: line.quantity,
        unit: line.unit || null,
        storageLocationId: line.storageLocationId || null,
        inventoryEntryId: line.inventoryEntryId || null,
        storageDetail: line.storageDetail || null,
        packageState: line.packageState,
        priority: line.priority,
        notes: line.notes || null,
      };
    });
    setBusy(true);
    setError("");
    try {
      const result = await request("/api/v1/shopping/register", "POST", { items });
      setRegistering(false);
      setRegistrationDrafts({});
      setMessage(
        `Registered ${result.registeredCount} item${result.registeredCount === 1 ? "" : "s"}${result.deferredCount ? `; deferred ${result.deferredCount} to the next trip` : ""}.`,
      );
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Could not register grocery shop.",
      );
    } finally {
      setBusy(false);
    }
  }

  const shoppingFields = (
    values: ShoppingDraft,
    change: <K extends keyof ShoppingDraft>(key: K, value: ShoppingDraft[K]) => void,
  ) => (
    <div className="form-grid">
      <label>
        Item
        <input
          required
          maxLength={200}
          placeholder="What do you need?"
          value={values.item}
          onChange={(event) => change("item", event.target.value)}
        />
      </label>
      <label>
        Category
        <input
          list="shopping-category-options"
          maxLength={100}
          placeholder="Choose or type"
          value={values.category}
          onChange={(event) => change("category", event.target.value)}
        />
      </label>
      <label>
        Quantity
        <input
          inputMode="decimal"
          pattern={quantityPattern}
          title="Use a positive number with up to three decimal places"
          value={values.quantity}
          onChange={(event) => change("quantity", event.target.value)}
        />
      </label>
      <label>
        Unit
        <input
          list="shopping-unit-options"
          maxLength={100}
          placeholder="e.g. can, g, bunch"
          value={values.unit}
          onChange={(event) => change("unit", event.target.value)}
        />
      </label>
      <label className="span-two">
        Notes
        <textarea
          maxLength={500}
          value={values.notes}
          onChange={(event) => change("notes", event.target.value)}
        />
      </label>
    </div>
  );

  return (
    <>
      <datalist id="shopping-category-options">
        {categories.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <datalist id="shopping-unit-options">
        {units.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>

      <div className="shopping-toolbar">
        <button
          className="primary-button"
          onClick={() => {
            setAdding(!adding);
            setEditingId(null);
            setRegistering(false);
          }}
        >
          {adding ? "Close" : "Add shopping item"}
        </button>
        <button
          className="secondary-button"
          disabled={!purchasedItems.length}
          onClick={beginRegistration}
        >
          Register grocery shop{purchasedItems.length ? ` (${purchasedItems.length})` : ""}
        </button>
        <label className="shopping-select-all">
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={allTripItemsSelected}
            disabled={!tripItems.length || busy}
            onChange={toggleAllForRegistration}
          />
          Select all for registration
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      {message && <p className="form-success">{message}</p>}

      {adding && (
        <form className="entity-form compact-form" onSubmit={add}>
          {shoppingFields(draft, changeDraft)}
          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button disabled={busy} className="primary-button">
              Add
            </button>
          </div>
        </form>
      )}

      {registering && (
        <form className="grocery-registration" onSubmit={finishRegistration}>
          <header>
            <div>
              <span className="eyebrow">Purchased items</span>
              <h2>Register grocery shop</h2>
              <p>
                Choose where each item is going, or defer it back to the list for the next trip.
              </p>
            </div>
            <button
              type="button"
              className="secondary-button ai-suggest-button"
              disabled={!aiConfigured || busy}
              title={
                aiConfigured
                  ? "Suggest storage and inventory matches"
                  : "Add OPENAI_API_KEY in Settings first"
              }
              onClick={() => recommendRegistration()}
            >
              {busy ? "Thinking…" : "Suggest with GPT-5.4"}
            </button>
          </header>
          {registrationFallback && (
            <AiFallbackOffer
              offer={registrationFallback}
              busy={busy}
              onRetry={() => recommendRegistration(registrationFallback.sourceJobId)}
            />
          )}
          <div className="registration-list">
            {purchasedItems.map((entry) => {
              const line = registrationDrafts[entry.id];
              if (!line) return null;
              return (
                <article className={`registration-item ${line.action}`} key={entry.id}>
                  <header>
                    <div>
                      <strong>{entry.item}</strong>
                      <small>
                        {formatQuantity(entry.quantity) || "Quantity not recorded"}{" "}
                        {entry.unit ?? ""}
                      </small>
                    </div>
                    <div className="registration-actions">
                      <button
                        type="button"
                        className={line.action === "register" ? "active" : ""}
                        onClick={() => changeRegistration(entry.id, { action: "register" })}
                      >
                        Stock item
                      </button>
                      <button
                        type="button"
                        className={line.action === "defer" ? "active defer" : ""}
                        onClick={() => changeRegistration(entry.id, { action: "defer" })}
                      >
                        Defer
                      </button>
                    </div>
                  </header>
                  {line.action === "defer" ? (
                    <p className="defer-note">
                      This item will return to the shopping list for a future trip.
                    </p>
                  ) : (
                    <div className="form-grid registration-grid">
                      <label>
                        Category
                        <input
                          required
                          list="shopping-category-options"
                          maxLength={100}
                          value={line.category}
                          onChange={(event) =>
                            changeRegistration(entry.id, { category: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Quantity
                        <input
                          required
                          inputMode="decimal"
                          pattern={quantityPattern}
                          title="Use a positive number with up to three decimal places"
                          value={line.quantity}
                          onChange={(event) =>
                            changeRegistration(entry.id, { quantity: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Unit
                        <input
                          list="shopping-unit-options"
                          maxLength={100}
                          value={line.unit}
                          onChange={(event) =>
                            changeRegistration(entry.id, { unit: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Location
                        <select
                          value={line.storageLocationId}
                          onChange={(event) => {
                            const location = locations.find(
                              (candidate) => candidate.id === event.target.value,
                            );
                            changeRegistration(entry.id, {
                              storageLocationId: event.target.value,
                              storageDetail: location?.detail ?? "",
                            });
                          }}
                        >
                          <option value="">No location / decide later</option>
                          {locations.map((location) => (
                            <option key={location.id} value={location.id}>
                              {location.name}
                              {location.detail ? ` · ${location.detail}` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="span-two">
                        Existing inventory match
                        <select
                          value={line.inventoryEntryId}
                          onChange={(event) => {
                            const matched = inventory.find(
                              (candidate) => candidate.id === event.target.value,
                            );
                            changeRegistration(entry.id, {
                              inventoryEntryId: event.target.value,
                              category: matched?.category ?? line.category,
                              unit: matched?.unit ?? line.unit,
                              storageLocationId:
                                matched?.storageLocationId ?? line.storageLocationId,
                              storageDetail: matched?.storageDetail ?? line.storageDetail,
                            });
                          }}
                        >
                          <option value="">Create a new inventory entry</option>
                          {inventory.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.ingredient}
                              {item.brandVariety ? ` · ${item.brandVariety}` : ""} ·{" "}
                              {formatQuantity(item.quantity)} {item.unit ?? ""}
                              {item.archivedAt ? " · restore previous entry" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Storage detail
                        <input
                          maxLength={500}
                          placeholder="Shelf, drawer, or bin"
                          value={line.storageDetail}
                          onChange={(event) =>
                            changeRegistration(entry.id, { storageDetail: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Package state
                        <select
                          value={line.packageState}
                          onChange={(event) =>
                            changeRegistration(entry.id, { packageState: event.target.value })
                          }
                        >
                          {PACKAGE_STATES.map((value) => (
                            <option key={value} value={value}>
                              {optionLabel(value)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Inventory priority
                        <select
                          value={line.priority}
                          onChange={(event) =>
                            changeRegistration(entry.id, { priority: event.target.value })
                          }
                        >
                          {INVENTORY_PRIORITIES.map((value) => (
                            <option key={value} value={value}>
                              {optionLabel(value)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Inventory notes
                        <input
                          maxLength={500}
                          value={line.notes}
                          onChange={(event) =>
                            changeRegistration(entry.id, { notes: event.target.value })
                          }
                        />
                      </label>
                      {registrationExplanations[entry.id] && (
                        <p className="ai-recommendation-note span-two">
                          <strong>AI suggestion:</strong> {registrationExplanations[entry.id]}
                        </p>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setRegistering(false)}
            >
              Cancel
            </button>
            <button disabled={busy} className="primary-button">
              Finish grocery shop
            </button>
          </div>
        </form>
      )}

      {!registering && (
        <div className="shopping-list">
          {initialItems.map((entry) => (
            <div className={`shopping-row ${entry.status}`} key={entry.id}>
              <input
                aria-label={`Mark ${entry.item} purchased`}
                type="checkbox"
                checked={entry.status === "purchased"}
                disabled={entry.status === "deferred"}
                onChange={() =>
                  patch(entry.id, { status: entry.status === "purchased" ? "to_buy" : "purchased" })
                }
              />
              <span>
                <strong>{entry.item}</strong>
                <small>
                  {entry.category || "Uncategorised"}
                  {entry.status === "deferred" ? " · Next trip" : ""}
                </small>
              </span>
              <em>
                {formatQuantity(entry.quantity)} {entry.unit ?? ""}
              </em>
              <div className="row-actions">
                {entry.status === "deferred" && (
                  <button onClick={() => patch(entry.id, { status: "to_buy" })}>Resume</button>
                )}
                <button onClick={() => startEdit(entry)}>Edit</button>
                <button disabled={busy} className="danger-link" onClick={() => remove(entry.id)}>
                  Remove
                </button>
              </div>
              {editingId === entry.id && (
                <form className="entity-form row-editor" onSubmit={saveEdit}>
                  {shoppingFields(editDraft, changeEditDraft)}
                  <div className="form-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </button>
                    <button disabled={busy} className="primary-button">
                      Save changes
                    </button>
                  </div>
                </form>
              )}
            </div>
          ))}
          {!initialItems.length && <p className="empty-state">The shopping list is empty.</p>}
        </div>
      )}
    </>
  );
}
