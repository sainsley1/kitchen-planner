import { describe, expect, it } from "vitest";
import { formatHouseholdDateTime, householdDateKey, householdSaturdayKey } from "../lib/datetime";

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
