import { describe, expect, it } from "vitest";
import { formatHouseholdDateTime, householdDateKey, householdSaturdayKey, formatDateKey, addDaysToDateKey } from "../lib/datetime";

describe("Vancouver household time", () => {
  it("converts UTC timestamps to the preceding PDT calendar date when appropriate", () => {
    const instant = "2026-07-15T06:00:00.000Z";
    expect(householdDateKey(instant)).toBe("2026-07-14");
    const display = formatHouseholdDateTime(instant);
    expect(display).toContain("Jul");
    expect(display).toContain("14");
    expect(display).toMatch(/PDT|GMT-7/);
  });

  it("uses PST in winter and computes the household Saturday", () => {
    expect(formatHouseholdDateTime("2026-01-15T20:00:00.000Z")).toMatch(/PST|GMT-8/);
    expect(householdSaturdayKey("2026-07-15T18:00:00.000Z")).toBe("2026-07-11");
  });
});

describe("formatDateKey", () => {
  it("formats a date string using Intl.DateTimeFormatOptions in UTC", () => {
    expect(formatDateKey("2024-01-15", { month: "short", day: "numeric" })).toBe("Jan 15");
    expect(formatDateKey("2024-12-31", { month: "long", day: "2-digit", year: "numeric" })).toBe("December 31, 2024");
  });

  it("handles different date keys appropriately", () => {
    expect(formatDateKey("2020-02-29", { month: "short", day: "numeric" })).toBe("Feb 29");
  });
});

describe("addDaysToDateKey", () => {
  it("adds positive days to a date string", () => {
    expect(addDaysToDateKey("2024-01-15", 5)).toBe("2024-01-20");
    expect(addDaysToDateKey("2024-12-25", 10)).toBe("2025-01-04");
  });

  it("subtracts days with negative numbers", () => {
    expect(addDaysToDateKey("2024-01-15", -5)).toBe("2024-01-10");
    expect(addDaysToDateKey("2024-01-05", -10)).toBe("2023-12-26");
  });

  it("handles month and year rollovers", () => {
    expect(addDaysToDateKey("2020-02-28", 1)).toBe("2020-02-29"); // Leap year
    expect(addDaysToDateKey("2021-02-28", 1)).toBe("2021-03-01"); // Non-leap year
  });

  it("throws an error for an invalid date string", () => {
    expect(() => addDaysToDateKey("invalid-date", 1)).toThrow("Invalid date key");
    expect(() => addDaysToDateKey("", 5)).toThrow("Invalid date key");
  });
});
