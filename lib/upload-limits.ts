/**
 * OpenAI file inputs must be under 50 MB. Keep a small safety margin so a
 * flyer accepted by Kitchen Planner is not subsequently rejected during AI
 * extraction.
 */
export const MAX_FLYER_UPLOAD_BYTES = 49_000_000;
export const MAX_FLYER_UPLOAD_LABEL = "49 MB";

export function flyerExceedsUploadLimit(size: number) {
  return size > MAX_FLYER_UPLOAD_BYTES;
}
