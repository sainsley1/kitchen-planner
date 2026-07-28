import { describe, expect, it } from "vitest";
import { inventoryAdjustmentSchema, mutationPolicy } from "../lib/ai/contracts";

describe("safe mutation contract", () => {
  it("rejects an unscoped natural-language database mutation", () => {
    const result = inventoryAdjustmentSchema.safeParse({
      operation: "subtract",
      quantity: 1,
      unit: "each",
      reason: "used one",
    });
    expect(result.success).toBe(false);
  });

  it("requires previews and forbids arbitrary SQL", () => {
    expect(mutationPolicy.requiresPreview).toBe(true);
    expect(mutationPolicy.arbitrarySqlAllowed).toBe(false);
  });
});
