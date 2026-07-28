import { describe, expect, it } from "vitest";
import { hashPin, hashSessionToken, newSessionToken, verifyPin } from "../lib/auth/crypto";
import { mealPatch, shoppingPatch } from "../lib/validation";

describe("household authentication primitives", () => {
  it("hashes and verifies PINs without retaining plaintext", () => {
    const encoded = hashPin("4826");
    expect(encoded).not.toContain("4826");
    expect(verifyPin("4826", encoded)).toBe(true);
    expect(verifyPin("4827", encoded)).toBe(false);
  });

  it("creates opaque session tokens and stable lookup hashes", () => {
    const token = newSessionToken();
    expect(token.length).toBeGreaterThan(30);
    expect(hashSessionToken(token)).toHaveLength(64);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });
});

describe("partial mutation validation", () => {
  it("does not invent shopping fields during a status-only patch", () => {
    expect(shoppingPatch.parse({ status: "purchased" })).toEqual({ status: "purchased" });
  });

  it("does not reset a meal during a status-only patch", () => {
    expect(mealPatch.parse({ status: "completed" })).toEqual({ status: "completed" });
  });
});
