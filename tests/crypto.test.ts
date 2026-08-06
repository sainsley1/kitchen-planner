import { describe, expect, it } from "vitest";
import { hashPin, verifyPin, newSessionToken, hashSessionToken } from "@/lib/auth/crypto";

describe("Crypto Utilities", () => {
  describe("hashPin and verifyPin", () => {
    it("should hash a pin and return a string starting with 'scrypt:'", () => {
      const pin = "1234";
      const hashed = hashPin(pin);
      expect(hashed).toMatch(/^scrypt:[0-9a-f]+:[0-9a-f]+$/);
    });

    it("should successfully verify a correct pin against its hash", () => {
      const pin = "123456";
      const hashed = hashPin(pin);
      expect(verifyPin(pin, hashed)).toBe(true);
    });

    it("should reject an incorrect pin", () => {
      const pin = "abcdef";
      const hashed = hashPin(pin);
      expect(verifyPin("wrongpin", hashed)).toBe(false);
    });

    it("should gracefully handle null or invalid encoded formats", () => {
      expect(verifyPin("1234", null)).toBe(false);
      expect(verifyPin("1234", "")).toBe(false);
      expect(verifyPin("1234", "invalid_format")).toBe(false);
      expect(verifyPin("1234", "scrypt:invalidhex:invalidhex")).toBe(false);
      expect(verifyPin("1234", "scrypt:a:b:c")).toBe(false); // Valid string splits differently but not hex
    });

    it("should generate different hashes for the same pin due to unique salts", () => {
      const pin = "password";
      const hashed1 = hashPin(pin);
      const hashed2 = hashPin(pin);
      expect(hashed1).not.toBe(hashed2);
    });
  });

  describe("newSessionToken", () => {
    it("should generate a non-empty string and produce unique values", () => {
      const token1 = newSessionToken();
      const token2 = newSessionToken();
      expect(token1).toBeTruthy();
      expect(typeof token1).toBe("string");
      expect(token1.length).toBeGreaterThan(0);
      expect(token1).not.toBe(token2);
    });
  });

  describe("hashSessionToken", () => {
    it("should produce a 64-character SHA-256 hex string", () => {
      const token = "some-random-session-token-value";
      const hashed = hashSessionToken(token);
      expect(typeof hashed).toBe("string");
      expect(hashed).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
