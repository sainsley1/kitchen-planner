import { describe, expect, it } from "vitest";
import { formatQuantity } from "../lib/format";

describe("quantity formatting", () => {
  it("removes only unnecessary decimal places and rounds repeating float measures", () => {
    expect(formatQuantity("4.000")).toBe("4");
    expect(formatQuantity("1.500")).toBe("1.5");
    expect(formatQuantity("10.010")).toBe("10.01");
    expect(formatQuantity("0.125")).toBe("0.125");
    expect(formatQuantity(4)).toBe("4");
    expect(formatQuantity(0.3333333333333333)).toBe("0.333");
    expect(formatQuantity("0.3333333333333333")).toBe("0.333");
    expect(formatQuantity(0.6666666666666666)).toBe("0.667");
  });

  it("preserves unknown text and handles missing quantities", () => {
    expect(formatQuantity(null)).toBe("");
    expect(formatQuantity(undefined)).toBe("");
    expect(formatQuantity("as needed")).toBe("as needed");
  });
});
