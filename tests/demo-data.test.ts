import { describe, expect, it } from "vitest";
import { demoFeedback, demoInventory, demoMeals, demoShopping } from "../lib/demo-data";

describe("synthetic Phase 2 fixtures", () => {
  it("contains no household names or workbook records", () => {
    const serialized = JSON.stringify({ demoFeedback, demoInventory, demoMeals, demoShopping }).toLowerCase();
    expect(serialized).not.toContain("seth");
    expect(serialized).not.toContain("nancy");
    expect(serialized).not.toContain("sausage pasta");
    expect(serialized).not.toContain("tacos de alambre");
  });

  it("uses stable unique identifiers", () => {
    for (const collection of [demoFeedback, demoInventory, demoShopping]) {
      const ids = collection.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("keeps at least one open meal slot visible", () => {
    expect(demoMeals.some((meal) => meal.status === "Open")).toBe(true);
  });
});
