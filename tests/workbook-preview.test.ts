import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseWorkbookPreview } from "../lib/import/workbook-preview";
import { normalizeWorkbookRow } from "../lib/import/workbook-normalize";

describe("workbook dry-run parser", () => {
  it("stages valid and uncertain inventory without creating commit data", async () => {
    const workbook = new ExcelJS.Workbook();
    const inventory = workbook.addWorksheet("Current Inventory");
    inventory.getRow(4).values = [
      "Ingredient",
      "Brand / Variety",
      "Category",
      "Quantity",
      "Unit",
      "Location",
      "Storage Detail",
      "Package State",
      "Best Before",
      "Priority",
      "Notes",
      "Last Verified",
    ];
    inventory.getRow(5).values = [
      "Chickpeas",
      "Canned",
      "Canned & Jarred",
      3,
      "can",
      "Pantry",
      "Top shelf",
      "Sealed",
      "",
      "Normal",
      "",
      "",
    ];
    inventory.getRow(6).values = [
      "Mystery spice",
      "",
      "Spices & Seasonings",
      "",
      "",
      "Pantry",
      "Middle shelf",
      "Unknown",
      "",
      "Normal",
      "",
      "",
    ];
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const rows = await parseWorkbookPreview(bytes);
    const inventoryRows = rows.filter((row) => row.sheet === "Current Inventory");
    expect(inventoryRows).toHaveLength(2);
    expect(inventoryRows[0].status).toBe("valid");
    expect(inventoryRows[0].normalized?.ingredient).toBe("Chickpeas");
    expect(inventoryRows[1].status).toBe("warning");
    expect(inventoryRows[1].messages[0]).toContain("not be treated as available");
    expect(rows.some((row) => row.sheet === "Food Profile" && row.row === 0)).toBe(true);
  });

  it("routes a dated-week item without an exact date to reconciliation as unscheduled", async () => {
    const workbook = new ExcelJS.Workbook();
    const meals = workbook.addWorksheet("Meal Plan Data");
    meals.getRow(4).values = [
      "Week Start",
      "Date",
      "Meal",
      "Person",
      "Dish",
      "Recipe URL",
      "Planned Yield",
      "Packed Lunch?",
      "Leftover / Prep Link",
      "Status",
      "Notes",
      "Last Updated",
      "Calendar Label",
      "Status Label",
    ];
    meals.getRow(5).values = [
      "2026-07-11",
      "",
      "Prep",
      "Household",
      "Homemade hummus",
      "",
      "Batch",
      "N/A",
      "Serve with cucumber",
      "Planned",
      "Make this week",
    ];
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const row = (await parseWorkbookPreview(bytes))
      .map(normalizeWorkbookRow)
      .find((entry) => entry.sheet === "Meal Plan Data" && entry.row === 5)!;
    expect(row.status).toBe("warning");
    expect(row.destinationType).toBe("unscheduled_item");
    expect(row.suggestedAction).toBe("import_unscheduled");
    expect(row.normalized?.title).toBe("Homemade hummus");
  });
});
