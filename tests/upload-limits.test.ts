import { describe, expect, it } from "vitest";
import { flyerExceedsUploadLimit, MAX_FLYER_UPLOAD_BYTES } from "@/lib/upload-limits";

describe("flyer upload limit", () => {
  it("accepts a 40-something MB flyer", () => {
    expect(flyerExceedsUploadLimit(45_000_000)).toBe(false);
  });

  it("keeps accepted files below the provider's 50 MB boundary", () => {
    expect(MAX_FLYER_UPLOAD_BYTES).toBe(49_000_000);
    expect(flyerExceedsUploadLimit(MAX_FLYER_UPLOAD_BYTES)).toBe(false);
    expect(flyerExceedsUploadLimit(MAX_FLYER_UPLOAD_BYTES + 1)).toBe(true);
  });
});
