import { describe, expect, it } from "vitest";
import { inventoryBulkInput } from "../lib/validation";

const id = "11111111-1111-4111-8111-111111111111";

describe("bulk inventory validation", () => {
  it("accepts only explicit, constrained bulk changes", () => {
    expect(
      inventoryBulkInput.parse({ action: "update", ids: [id], patch: { priority: "use_soon" } }),
    ).toMatchObject({ action: "update" });
    expect(inventoryBulkInput.safeParse({ action: "update", ids: [id], patch: {} }).success).toBe(
      false,
    );
    expect(
      inventoryBulkInput.safeParse({ action: "update", ids: [id], patch: { priority: "whenever" } })
        .success,
    ).toBe(false);
  });

  it("defaults a bulk removal to no shopping mutation", () => {
    expect(inventoryBulkInput.parse({ action: "archive", ids: [id] })).toEqual({
      action: "archive",
      ids: [id],
      addToShopping: false,
    });
  });
});
