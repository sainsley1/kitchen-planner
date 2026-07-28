import { z } from "zod";
import { importDestinations, type ImportDestination } from "./workbook-normalize";

const nullableText = (maximum = 2_000) =>
  z
    .union([z.string().trim().max(maximum), z.null()])
    .transform((value) => (value === "" ? null : value));
const nullableNumber = z
  .union([z.coerce.number().nonnegative(), z.literal(""), z.null()])
  .transform((value) => (value === "" || value == null ? null : value));
const person = nullableText(200);
const recipeUrl = z
  .union([z.string().url().startsWith("http").max(2_000), z.literal(""), z.null()])
  .transform((value) => value || null);
const optionalDate = z
  .union([z.string().date(), z.literal(""), z.null()])
  .transform((value) => value || null);
const mealType = z.enum(["breakfast", "lunch", "dinner", "snack", "dessert", "prep"]);
const mealStatus = z.enum([
  "planned",
  "completed",
  "changed",
  "deferred",
  "skipped",
  "open",
  "unconfirmed",
]);

export const normalizedPayloadSchemas = {
  inventory_entry: z.object({
    ingredient: z.string().trim().min(1).max(200),
    brandVariety: nullableText(500),
    category: z.string().trim().min(1).max(100),
    quantity: nullableNumber,
    unit: nullableText(100),
    locationName: z.string().trim().min(1).max(200),
    storageDetail: nullableText(500),
    packageState: z.enum(["sealed", "opened", "full", "partial", "nearly_empty", "unknown"]),
    bestBefore: optionalDate,
    priority: z.enum(["normal", "use_soon", "use_now", "reserved"]),
    notes: nullableText(),
    verifiedAt: optionalDate,
  }),
  food_preference: z.object({
    person,
    topic: z.string().trim().min(1).max(300),
    classification: z.string().trim().min(1).max(100),
    detail: z.string().trim().min(1).max(2_000),
    context: nullableText(500),
    status: z.enum(["active", "contextual", "superseded"]),
    effectiveDate: optionalDate,
  }),
  meal_feedback: z.object({
    feedbackDate: z.string().date(),
    dish: z.string().trim().min(1).max(300),
    mealType,
    recipeUrl,
    recipeNote: nullableText(2_000),
    person,
    rating: z.enum(["Love", "Like", "Mixed", "Dislike"]),
    feedback: z.string().trim().min(1).max(2_000),
    nextTimeChanges: nullableText(2_000),
    repeatDecision: nullableText(500),
  }),
  staple_target: z.object({
    ingredient: z.string().trim().min(1).max(200),
    category: nullableText(100),
    targetMinimum: nullableNumber,
    unit: nullableText(100),
    preferredBrand: nullableText(500),
    currentStatus: nullableText(500),
    reorderRule: nullableText(2_000),
    notes: nullableText(2_000),
    reviewedAt: optionalDate,
  }),
  shopping_item: z.object({
    item: z.string().trim().min(1).max(200),
    category: nullableText(100),
    quantity: nullableNumber,
    unit: nullableText(100),
    status: z.enum(["to_buy", "purchased", "deferred", "removed"]),
    notes: nullableText(2_000),
    dateAdded: optionalDate,
  }),
  meal_plan_entry: z.object({
    mealDate: z.string().date(),
    mealType,
    assignedPerson: person,
    dish: z.string().trim().min(1).max(300),
    recipeUrl,
    recipeNote: nullableText(2_000),
    plannedYield: nullableText(500),
    packedLunch: z.boolean().nullable(),
    leftoverPrepLink: nullableText(2_000),
    status: mealStatus,
    notes: nullableText(2_000),
  }),
  unscheduled_item: z.object({
    weekStart: z.string().date(),
    itemType: mealType,
    assignedPerson: person,
    title: z.string().trim().min(1).max(300),
    recipeUrl,
    recipeNote: nullableText(2_000),
    plannedYield: nullableText(500),
    status: mealStatus,
    notes: nullableText(2_000),
  }),
} satisfies Record<ImportDestination, z.ZodType>;

export const resolutionInput = z.object({
  action: z.enum(["import", "skip", "import_unscheduled", "use_existing", "replace_existing"]),
  payload: z.record(z.string(), z.unknown()).nullable().optional(),
  targetId: z
    .union([z.string().uuid(), z.literal(""), z.null()])
    .optional()
    .transform((value) => value || null),
});

export function parseImportPayload(destination: string, payload: unknown): Record<string, unknown> {
  const destinationResult = z.enum(importDestinations).safeParse(destination);
  if (!destinationResult.success)
    throw new Error("The staged row does not have a supported destination");
  return normalizedPayloadSchemas[destinationResult.data].parse(payload) as Record<string, unknown>;
}
