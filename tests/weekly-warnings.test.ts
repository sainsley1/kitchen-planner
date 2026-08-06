import { describe, expect, it } from "vitest";
import {
  boundWeeklyPlanWarnings,
  WEEKLY_PLAN_WARNING_OVERFLOW_PREFIX,
} from "../lib/services/weekly-warnings";

describe("boundWeeklyPlanWarnings", () => {
  it("removes duplicates, trims whitespace, and filters empty strings", () => {
    const input = [" warning1 ", "warning2", "", "warning1", "  "];
    const result = boundWeeklyPlanWarnings(input, 10);
    expect(result).toEqual(["warning1", "warning2"]);
  });

  it("returns unmodified array if under the limit", () => {
    const input = ["w1", "w2", "w3"];
    const result = boundWeeklyPlanWarnings(input, 5);
    expect(result).toEqual(["w1", "w2", "w3"]);
  });

  it("enforces limit by slicing and appending summary warning when exceeded", () => {
    const input = ["w1", "w2", "w3", "w4", "w5"];
    const result = boundWeeklyPlanWarnings(input, 3);
    // Limit is 3, so it should retain 2 and add 1 summary.
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("w1");
    expect(result[1]).toBe("w2");
    expect(result[2]).toBe(
      `${WEEKLY_PLAN_WARNING_OVERFLOW_PREFIX} 3 additional distinct warnings were condensed to keep this plan reviewable.`,
    );
  });

  it("handles pluralization for exactly 1 omitted warning", () => {
    const input = ["w1", "w2", "w3"];
    const result = boundWeeklyPlanWarnings(input, 2);
    // Limit is 2, retain 1 and add 1 summary.
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("w1");
    expect(result[1]).toBe(
      `${WEEKLY_PLAN_WARNING_OVERFLOW_PREFIX} 2 additional distinct warnings were condensed to keep this plan reviewable.`,
    );
  });

  it("handles singular pluralization when exactly 1 previously omitted warning is carried over and limits aren't exceeded", () => {
    const input = [
      "w1",
      "w2",
      `${WEEKLY_PLAN_WARNING_OVERFLOW_PREFIX} 1 additional distinct warning was condensed to keep this plan reviewable.`,
    ];
    const result = boundWeeklyPlanWarnings(input, 5);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("w1");
    expect(result[1]).toBe("w2");
    expect(result[2]).toBe(
      `${WEEKLY_PLAN_WARNING_OVERFLOW_PREFIX} 1 additional distinct warning was condensed to keep this plan reviewable.`,
    );
  });

  it("extracts and recounts counts from previously omitted warnings", () => {
    const input = [
      "w1",
      `${WEEKLY_PLAN_WARNING_OVERFLOW_PREFIX} 5 additional distinct warnings were condensed to keep this plan reviewable.`,
      "w2",
      `${WEEKLY_PLAN_WARNING_OVERFLOW_PREFIX} 10 additional distinct warnings were condensed to keep this plan reviewable.`,
    ];
    // Under limit for the actual elements to be kept (w1, w2, summary) = 3 elements
    const result = boundWeeklyPlanWarnings(input, 5);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("w1");
    expect(result[1]).toBe("w2");
    // Omitted count = 5 + 10 = 15
    expect(result[2]).toBe(
      `${WEEKLY_PLAN_WARNING_OVERFLOW_PREFIX} 15 additional distinct warnings were condensed to keep this plan reviewable.`,
    );
  });

  it("extracts and recounts counts and combines with newly omitted items", () => {
    const input = [
      "w1",
      "w2",
      "w3",
      "w4",
      `${WEEKLY_PLAN_WARNING_OVERFLOW_PREFIX} 5 additional distinct warnings were condensed to keep this plan reviewable.`,
    ];
    // Limit is 3. Elements to keep: 3.
    // Retained = w1, w2 (2 elements).
    // Original unique = w1, w2, w3, w4 (4 elements).
    // Omitted items = 4 - 2 = 2.
    // Previously omitted = 5.
    // Total omitted = 2 + 5 = 7.
    const result = boundWeeklyPlanWarnings(input, 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("w1");
    expect(result[1]).toBe("w2");
    expect(result[2]).toBe(
      `${WEEKLY_PLAN_WARNING_OVERFLOW_PREFIX} 7 additional distinct warnings were condensed to keep this plan reviewable.`,
    );
  });

  it("handles limit <= 0 by returning an empty array", () => {
    const input = ["w1", "w2"];
    expect(boundWeeklyPlanWarnings(input, 0)).toEqual([]);
    expect(boundWeeklyPlanWarnings(input, -1)).toEqual([]);
  });

  it("handles fallback if prefix exists but no valid number", () => {
    const input = ["w1", `${WEEKLY_PLAN_WARNING_OVERFLOW_PREFIX} some text here`];
    // It should count the previously omitted as 1
    const result = boundWeeklyPlanWarnings(input, 5);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("w1");
    expect(result[1]).toBe(
      `${WEEKLY_PLAN_WARNING_OVERFLOW_PREFIX} 1 additional distinct warning was condensed to keep this plan reviewable.`,
    );
  });
});
