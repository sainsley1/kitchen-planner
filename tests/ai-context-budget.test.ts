import { describe, expect, it } from "vitest";
import { compactQuickContext, type QuickContext } from "../lib/ai/context";

function context(): QuickContext {
  return {
    today: "2026-07-15",
    locations: [
      { id: "fridge", name: "Fridge", detail: null },
      { id: "pantry", name: "Pantry", detail: null },
    ],
    inventory: Array.from({ length: 500 }, (_, index) => ({
      id: `inventory-${index}`,
      ingredient: index === 417 ? "Rice crackers" : `Unrelated pantry item ${index}`,
      brandVariety: null,
      category: index === 417 ? "Snacks" : "Pantry",
      quantity: "1.000",
      unit: "package",
      locationName: "Pantry",
      storageLocationId: "pantry",
      storageDetail: index === 417 ? "Bottom shelf" : null,
      packageState: "sealed",
      priority: "normal",
      notes: "A deliberately verbose note that should never be sent in compact routine context.",
    })),
    shopping: Array.from({ length: 200 }, (_, index) => ({
      id: `shopping-${index}`,
      item: index === 123 ? "Rice crackers" : `Other purchase ${index}`,
      category: index === 123 ? "Snacks" : "Other",
      quantity: "1.000",
      unit: "package",
      status: "to_buy",
      notes: null,
    })),
  };
}

describe("quick-update context budget", () => {
  it("keeps only relevant local matches under hard record caps", () => {
    const compact = compactQuickContext(
      "Morgan brought home some rice crackers and put them on the bottom shelf of the pantry",
      context(),
    );
    expect(compact.inventory.map((item) => item.id)).toContain("inventory-417");
    expect(compact.shopping.map((item) => item.id)).toContain("shopping-123");
    expect(compact.locations).toEqual([{ id: "pantry", name: "Pantry", detail: null }]);
    expect(compact.inventory.length).toBeLessThanOrEqual(12);
    expect(compact.shopping.length).toBeLessThanOrEqual(8);
    expect(JSON.stringify(compact).length).toBeLessThan(15_000);
    expect(JSON.stringify(compact)).not.toContain("deliberately verbose note");
  });
});
