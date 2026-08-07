"use client";

import type { WeeklyPlan } from "@/lib/ai/contracts";
import type {
  HouseholdUserRecord,
  InventoryRecord,
  RecipeRecord,
  UnscheduledRecord,
  WeeklyPlanRecord,
} from "@/lib/db/queries";
import { formatQuantity } from "@/lib/format";
import { MEAL_TYPES, optionLabel } from "@/lib/options";
import type {
  CoverageException,
  IngredientRequirement,
  InventorySearchState,
  Meal,
  SetInventorySearchFn,
  ShoppingDecision,
  ShoppingLine,
} from "./types";

function blankMeal(plan: WeeklyPlanRecord): Meal {
  return {
    id: `manual-${Date.now()}`,
    mealDate: plan.startDate,
    mealType: "breakfast",
    assignedUserId: null,
    dish: "New meal",
    cuisine: "Flexible",
    technique: "assembly",
    primaryIngredients: [],
    preparationBasis: "assembly",
    preparationMethod: "Assemble the listed ingredients and season to taste.",
    ingredientRequirements: [],
    saleItemIds: [],
    discovery: false,
    recipeId: null,
    recipeTitle: null,
    recipeUrl: null,
    servings: 2,
    leftoverServings: 0,
    leftoverFromMealId: null,
    packedLunch: false,
    workplaceMeal: false,
    workplaceFriendly: true,
    intensity: "moderate",
    prepMinutes: 20,
    plannedYield: "2 servings",
    rationale: "Added during plan review.",
    notes: null,
    unscheduledItemId: null,
    inventoryUses: [],
  };
}

function blankException(plan: WeeklyPlanRecord, userId: string): CoverageException {
  return {
    id: `exception-${Date.now()}`,
    mealDate: plan.startDate,
    mealType: "breakfast",
    userId,
    reason: "No meal is needed.",
  };
}

function blankShopping(): ShoppingLine {
  return {
    id: `shopping-${Date.now()}`,
    item: "New item",
    requirementKey: null,
    category: "Other",
    quantity: 1,
    unit: "each",
    reason: "Needed for the reviewed weekly plan.",
    mealIds: [],
    suggestedStore: null,
    saleItemId: null,
    estimatedPrice: null,
  };
}

interface WeeklyPlanEditorProps {
  plan: WeeklyPlanRecord;
  payload: WeeklyPlan;
  users: HouseholdUserRecord[];
  recipes: RecipeRecord[];
  unscheduled: UnscheduledRecord[];
  inventory: InventoryRecord[];
  busy: boolean;
  inventorySearch: InventorySearchState | null;
  setInventorySearch: SetInventorySearchFn;
  setDraft: React.Dispatch<React.SetStateAction<WeeklyPlan | null>>;
  updateMeal: (index: number, patch: Partial<Meal>) => void;
  updateRequirement: (
    mealIndex: number,
    requirementIndex: number,
    patch: Partial<IngredientRequirement>,
  ) => void;
  updateException: (index: number, patch: Partial<CoverageException>) => void;
  updateShopping: (index: number, patch: Partial<ShoppingLine>) => void;
  setShoppingDecision: (
    line: ShoppingLine,
    action: ShoppingDecision["action"],
    inventoryEntryId: string | null,
  ) => void;
  undoShoppingDecision: (requirementKey: string) => void;
  onCancel: () => void;
  onSave: (planId: string) => void;
}

export function WeeklyPlanEditor({
  plan,
  payload,
  users,
  recipes,
  unscheduled,
  inventory,
  busy,
  inventorySearch,
  setInventorySearch,
  setDraft,
  updateMeal,
  updateRequirement,
  updateException,
  updateShopping,
  setShoppingDecision,
  undoShoppingDecision,
  onCancel,
  onSave,
}: WeeklyPlanEditorProps) {
  const availableUnscheduled = unscheduled.filter((item) =>
    ["planned", "open", "unconfirmed"].includes(item.status),
  );

  return (
    <div className="weekly-plan-editor">
      <div className="plan-overview-edit form-grid">
        <label className="span-two">
          Plan title
          <input
            value={payload.title}
            onChange={(event) =>
              setDraft((current) => (current ? { ...current, title: event.target.value } : current))
            }
          />
        </label>
        <label className="span-two">
          Summary
          <textarea
            value={payload.summary}
            onChange={(event) =>
              setDraft((current) =>
                current ? { ...current, summary: event.target.value } : current,
              )
            }
          />
        </label>
        <label className="span-two">
          Strategy
          <textarea
            value={payload.strategy}
            onChange={(event) =>
              setDraft((current) =>
                current ? { ...current, strategy: event.target.value } : current,
              )
            }
          />
        </label>
        <label className="span-two">
          Planner warnings, one per line
          <textarea
            value={payload.warnings.join("\n")}
            onChange={(event) =>
              setDraft((current) =>
                current
                  ? {
                      ...current,
                      warnings: event.target.value
                        .split("\n")
                        .map((line) => line.trim())
                        .filter(Boolean),
                    }
                  : current,
              )
            }
          />
        </label>
      </div>
      <div className="editor-toolbar">
        <strong>Editing revision {plan.revisionNumber + 1}</strong>
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            setDraft((current) =>
              current ? { ...current, meals: [...current.meals, blankMeal(plan)] } : current,
            )
          }
        >
          Add meal
        </button>
      </div>
      {payload.meals.map((meal, index) => (
        <div className="plan-meal-edit" key={meal.id}>
          <div className="plan-meal-edit-grid">
            <label>
              Date
              <input
                type="date"
                min={plan.startDate}
                max={plan.endDate}
                value={meal.mealDate}
                onChange={(event) => updateMeal(index, { mealDate: event.target.value })}
              />
            </label>
            <label>
              Meal
              <select
                value={meal.mealType}
                onChange={(event) =>
                  updateMeal(index, {
                    mealType: event.target.value as Meal["mealType"],
                  })
                }
              >
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
                value={meal.assignedUserId ?? ""}
                onChange={(event) =>
                  updateMeal(index, { assignedUserId: event.target.value || null })
                }
              >
                <option value="">Household</option>
                {users.map((user) => (
                  <option value={user.id} key={user.id}>
                    {user.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="span-two">
              Dish
              <input
                value={meal.dish}
                onChange={(event) => updateMeal(index, { dish: event.target.value })}
              />
            </label>
            <label>
              Cuisine
              <input
                value={meal.cuisine}
                onChange={(event) => updateMeal(index, { cuisine: event.target.value })}
              />
            </label>
            <label>
              Technique
              <input
                value={meal.technique}
                onChange={(event) => updateMeal(index, { technique: event.target.value })}
              />
            </label>
            <label>
              Preparation basis
              <select
                value={meal.preparationBasis}
                onChange={(event) =>
                  updateMeal(index, {
                    preparationBasis: event.target.value as Meal["preparationBasis"],
                  })
                }
              >
                <option value="saved_recipe">Saved recipe</option>
                <option value="verified_recipe">Verified recipe</option>
                <option value="guided_method">Guided method</option>
                <option value="assembly">Assembly</option>
                <option value="prepared_food">Prepared food</option>
                <option value="leftover">Leftover</option>
              </select>
            </label>
            <label className="span-two">
              Primary ingredients
              <input
                value={meal.primaryIngredients.join(", ")}
                onChange={(event) =>
                  updateMeal(index, {
                    primaryIngredients: event.target.value
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean)
                      .slice(0, 12),
                  })
                }
              />
            </label>
            <label>
              Servings
              <input
                type="number"
                min="1"
                max="40"
                value={meal.servings}
                onChange={(event) => updateMeal(index, { servings: Number(event.target.value) })}
              />
            </label>
            <label>
              Reserve leftovers
              <input
                type="number"
                min="0"
                max="40"
                value={meal.leftoverServings}
                onChange={(event) =>
                  updateMeal(index, { leftoverServings: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Use leftovers from
              <select
                value={meal.leftoverFromMealId ?? ""}
                onChange={(event) =>
                  updateMeal(index, { leftoverFromMealId: event.target.value || null })
                }
              >
                <option value="">Not leftovers</option>
                {payload.meals
                  .filter((source) => source.id !== meal.id && source.mealDate < meal.mealDate)
                  .map((source) => (
                    <option value={source.id} key={source.id}>
                      {source.mealDate} · {source.dish}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Prep minutes
              <input
                type="number"
                min="0"
                max="720"
                value={meal.prepMinutes}
                onChange={(event) => updateMeal(index, { prepMinutes: Number(event.target.value) })}
              />
            </label>
            <label>
              Intensity
              <select
                value={meal.intensity}
                onChange={(event) =>
                  updateMeal(index, {
                    intensity: event.target.value as Meal["intensity"],
                  })
                }
              >
                <option value="light">Light</option>
                <option value="moderate">Moderate</option>
                <option value="substantial">Substantial</option>
              </select>
            </label>
            <label>
              Yield
              <input
                value={meal.plannedYield}
                onChange={(event) => updateMeal(index, { plannedYield: event.target.value })}
              />
            </label>
            <label>
              Saved recipe
              <select
                value={meal.recipeId ?? ""}
                onChange={(event) => {
                  const recipe = recipes.find((entry) => entry.id === event.target.value);
                  updateMeal(
                    index,
                    recipe
                      ? {
                          recipeId: recipe.id,
                          recipeTitle: recipe.title,
                          recipeUrl: recipe.sourceUrl,
                          plannedYield: recipe.plannedYield ?? meal.plannedYield,
                          preparationBasis: "saved_recipe",
                        }
                      : { recipeId: null },
                  );
                }}
              >
                <option value="">Not linked</option>
                {recipes
                  .filter((recipe) => recipe.recipeStatus !== "avoid")
                  .map((recipe) => (
                    <option key={recipe.id} value={recipe.id}>
                      {recipe.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Recipe title
              <input
                value={meal.recipeTitle ?? ""}
                onChange={(event) => updateMeal(index, { recipeTitle: event.target.value || null })}
              />
            </label>
            <label className="span-two">
              Recipe URL
              <input
                type="url"
                value={meal.recipeUrl ?? ""}
                onChange={(event) => updateMeal(index, { recipeUrl: event.target.value || null })}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={meal.packedLunch}
                onChange={(event) => updateMeal(index, { packedLunch: event.target.checked })}
              />
              Packed lunch
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={meal.workplaceMeal}
                onChange={(event) => updateMeal(index, { workplaceMeal: event.target.checked })}
              />
              Workplace meal
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={meal.workplaceFriendly}
                onChange={(event) => updateMeal(index, { workplaceFriendly: event.target.checked })}
              />
              Workplace-friendly
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={meal.discovery}
                onChange={(event) => updateMeal(index, { discovery: event.target.checked })}
              />
              New discovery
            </label>
            <label className="span-two">
              Linked Unscheduled item
              <select
                value={meal.unscheduledItemId ?? ""}
                onChange={(event) =>
                  updateMeal(index, { unscheduledItemId: event.target.value || null })
                }
              >
                <option value="">Not linked</option>
                {availableUnscheduled.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.title} · week of {item.weekStart}
                  </option>
                ))}
              </select>
            </label>
            <label className="span-two">
              Preparation method
              <textarea
                value={meal.preparationMethod ?? ""}
                onChange={(event) =>
                  updateMeal(index, { preparationMethod: event.target.value || null })
                }
              />
            </label>
            <label className="span-two">
              Rationale
              <textarea
                value={meal.rationale}
                onChange={(event) => updateMeal(index, { rationale: event.target.value })}
              />
            </label>
            <label className="span-two">
              Notes
              <textarea
                value={meal.notes ?? ""}
                onChange={(event) => updateMeal(index, { notes: event.target.value || null })}
              />
            </label>
          </div>
          <div className="meal-requirement-editor">
            <header>
              <strong>Complete ingredients</strong>
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  updateMeal(index, {
                    ingredientRequirements: [
                      ...meal.ingredientRequirements,
                      {
                        item: "New ingredient",
                        category: "Other",
                        quantity: null,
                        unit: null,
                        optional: false,
                        inventoryEntryId: null,
                      },
                    ],
                  })
                }
              >
                Add ingredient
              </button>
            </header>
            {meal.ingredientRequirements.map((requirement, requirementIndex) => (
              <div
                className="meal-requirement-row"
                key={`${meal.id}-requirement-${requirementIndex}`}
              >
                <input
                  aria-label="Ingredient"
                  value={requirement.item}
                  onChange={(event) =>
                    updateRequirement(index, requirementIndex, {
                      item: event.target.value,
                    })
                  }
                />
                <input
                  aria-label="Ingredient category"
                  value={requirement.category}
                  onChange={(event) =>
                    updateRequirement(index, requirementIndex, {
                      category: event.target.value,
                    })
                  }
                />
                <input
                  aria-label="Ingredient quantity"
                  type="number"
                  min="0"
                  step="any"
                  value={requirement.quantity ?? ""}
                  onChange={(event) =>
                    updateRequirement(index, requirementIndex, {
                      quantity: event.target.value === "" ? null : Number(event.target.value),
                    })
                  }
                />
                <input
                  aria-label="Ingredient unit"
                  value={requirement.unit ?? ""}
                  onChange={(event) =>
                    updateRequirement(index, requirementIndex, {
                      unit: event.target.value || null,
                    })
                  }
                />
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={requirement.optional}
                    onChange={(event) =>
                      updateRequirement(index, requirementIndex, {
                        optional: event.target.checked,
                      })
                    }
                  />
                  Optional
                </label>
                <button
                  type="button"
                  className="danger-link"
                  onClick={() =>
                    updateMeal(index, {
                      ingredientRequirements: meal.ingredientRequirements.filter(
                        (_, innerIndex) => innerIndex !== requirementIndex,
                      ),
                    })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="danger-link"
            onClick={() =>
              setDraft((current) =>
                current
                  ? {
                      ...current,
                      meals: current.meals.filter((_, mealIndex) => mealIndex !== index),
                    }
                  : current,
              )
            }
          >
            Remove meal
          </button>
        </div>
      ))}

      <div className="editor-toolbar">
        <strong>No-meal exceptions</strong>
        <button
          type="button"
          className="secondary-button"
          disabled={!users.length}
          onClick={() =>
            setDraft((current) =>
              current && users[0]
                ? {
                    ...current,
                    coverageExceptions: [
                      ...current.coverageExceptions,
                      blankException(plan, users[0].id),
                    ],
                  }
                : current,
            )
          }
        >
          Add exception
        </button>
      </div>
      {payload.coverageExceptions.map((entry, index) => (
        <div className="plan-exception-edit" key={entry.id}>
          <label>
            Date
            <input
              type="date"
              min={plan.startDate}
              max={plan.endDate}
              value={entry.mealDate}
              onChange={(event) => updateException(index, { mealDate: event.target.value })}
            />
          </label>
          <label>
            Meal
            <select
              value={entry.mealType}
              onChange={(event) =>
                updateException(index, {
                  mealType: event.target.value as CoverageException["mealType"],
                })
              }
            >
              <option value="breakfast">Breakfast</option>
              <option value="lunch">Lunch</option>
              <option value="dinner">Dinner</option>
            </select>
          </label>
          <label>
            Person
            <select
              value={entry.userId}
              onChange={(event) => updateException(index, { userId: event.target.value })}
            >
              {users.map((user) => (
                <option value={user.id} key={user.id}>
                  {user.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reason
            <input
              value={entry.reason}
              onChange={(event) => updateException(index, { reason: event.target.value })}
            />
          </label>
          <button
            type="button"
            className="danger-link"
            onClick={() =>
              setDraft((current) =>
                current
                  ? {
                      ...current,
                      coverageExceptions: current.coverageExceptions.filter(
                        (_, entryIndex) => entryIndex !== index,
                      ),
                    }
                  : current,
              )
            }
          >
            Remove
          </button>
        </div>
      ))}

      <div className="editor-toolbar">
        <strong>Proposed shopping</strong>
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            setDraft((current) =>
              current ? { ...current, shopping: [...current.shopping, blankShopping()] } : current,
            )
          }
        >
          Add item
        </button>
      </div>
      {payload.shopping
        .map((item, index) => ({ item, index }))
        .filter(
          ({ item }) =>
            !item.requirementKey ||
            !payload.shoppingDecisions.some(
              (decision) => decision.requirementKey === item.requirementKey,
            ),
        )
        .map(({ item, index }) => (
          <div className="plan-shopping-edit" key={item.id}>
            <input
              aria-label="Shopping item"
              value={item.item}
              onChange={(event) => updateShopping(index, { item: event.target.value })}
            />
            <input
              aria-label="Category"
              value={item.category}
              onChange={(event) => updateShopping(index, { category: event.target.value })}
            />
            <input
              aria-label="Quantity"
              type="number"
              min="0"
              step="any"
              value={item.quantity ?? ""}
              onChange={(event) =>
                updateShopping(index, {
                  quantity: event.target.value === "" ? null : Number(event.target.value),
                })
              }
            />
            <input
              aria-label="Unit"
              value={item.unit ?? ""}
              onChange={(event) => updateShopping(index, { unit: event.target.value || null })}
            />
            <input
              aria-label="Reason"
              value={item.reason}
              onChange={(event) => updateShopping(index, { reason: event.target.value })}
            />
            <button
              type="button"
              className="danger-link"
              onClick={() => {
                if (item.requirementKey) {
                  setShoppingDecision(item, "exclude", null);
                  return;
                }
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        shopping: current.shopping.filter((_, itemIndex) => itemIndex !== index),
                      }
                    : current,
                );
              }}
            >
              Remove
            </button>
            {item.requirementKey && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setInventorySearch({ line: item, query: item.item })}
              >
                Find in inventory
              </button>
            )}
          </div>
        ))}
      {inventorySearch && (
        <div className="plan-inventory-association">
          <div className="editor-toolbar">
            <strong>Inventory for {inventorySearch.line.item}</strong>
            <button type="button" className="danger-link" onClick={() => setInventorySearch(null)}>
              Cancel
            </button>
          </div>
          <input
            autoFocus
            aria-label="Search current inventory"
            value={inventorySearch.query}
            onChange={(event) =>
              setInventorySearch((current) =>
                current ? { ...current, query: event.target.value } : current,
              )
            }
          />
          <div className="inventory-association-results">
            {inventory
              .filter((entry) => {
                const query = inventorySearch.query.trim().toLocaleLowerCase();
                return (
                  !query ||
                  `${entry.ingredient} ${entry.brandVariety ?? ""} ${entry.category}`
                    .toLocaleLowerCase()
                    .includes(query)
                );
              })
              .slice(0, 20)
              .map((entry) => (
                <button
                  type="button"
                  className="inventory-association-option"
                  key={entry.id}
                  onClick={() => setShoppingDecision(inventorySearch.line, "inventory", entry.id)}
                >
                  <strong>
                    {entry.ingredient}
                    {entry.brandVariety ? ` · ${entry.brandVariety}` : ""}
                  </strong>
                  <span>
                    {formatQuantity(entry.quantity)} {entry.unit ?? ""} ·{" "}
                    {entry.locationName ?? "No location"}
                  </span>
                </button>
              ))}
          </div>
        </div>
      )}
      {payload.shoppingDecisions.length > 0 && (
        <div className="plan-shopping-decisions">
          <strong>Reviewed ingredient decisions</strong>
          {payload.shoppingDecisions.map((decision) => {
            const linkedInventory = decision.inventoryEntryId
              ? inventory.find((entry) => entry.id === decision.inventoryEntryId)
              : null;
            const sourceLine = payload.shopping.find(
              (line) => line.requirementKey === decision.requirementKey,
            ) ?? {
              id: `decision-${decision.requirementKey}`,
              item: decision.item,
              requirementKey: decision.requirementKey,
              category: linkedInventory?.category ?? "Other",
              quantity: null,
              unit: decision.unit,
              reason: "Reviewed ingredient decision.",
              mealIds: decision.mealIds,
              suggestedStore: null,
              saleItemId: null,
              estimatedPrice: null,
            };
            return (
              <div className="plan-shopping-decision" key={decision.requirementKey}>
                <span>
                  <strong>{decision.item}</strong>
                  {decision.action === "inventory"
                    ? ` covered by ${linkedInventory?.ingredient ?? "unavailable inventory"}${linkedInventory?.brandVariety ? ` · ${linkedInventory.brandVariety}` : ""}`
                    : " manually excluded from this draft"}
                </span>
                {decision.action === "inventory" && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setInventorySearch({ line: sourceLine, query: decision.item })}
                  >
                    Change
                  </button>
                )}
                <button
                  type="button"
                  className="danger-link"
                  onClick={() => undoShoppingDecision(decision.requirementKey)}
                >
                  Undo
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="form-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={busy}
          onClick={() => onSave(plan.id)}
        >
          Save and validate revision
        </button>
      </div>
    </div>
  );
}
