import { z } from "zod";
import {
  FEEDBACK_RATINGS,
  INVENTORY_PRIORITIES,
  MEAL_STATUSES,
  MEAL_TYPES,
  PACKAGE_STATES,
  SHOPPING_STATUSES,
} from "@/lib/options";

const nullableText = z
  .union([z.string().trim().max(500), z.null()])
  .optional()
  .transform((value) => (value === "" ? null : (value ?? null)));
const quantityNumber = z.coerce
  .number()
  .nonnegative()
  .max(999_999_999.999)
  .transform((value) => Math.round((value + Number.EPSILON) * 1_000) / 1_000);
const nullableNumber = z
  .preprocess((value) => (value === "" || value == null ? null : value), quantityNumber.nullable())
  .optional()
  .transform((value) => value ?? null);
const optionalNullableNumber = z.preprocess(
  (value) => (value === "" ? null : value),
  quantityNumber.nullable().optional(),
);

export const inventoryInput = z.object({
  ingredient: z.string().trim().min(1).max(200),
  brandVariety: nullableText,
  category: z.string().trim().min(1).max(100),
  quantity: nullableNumber,
  unit: nullableText,
  storageLocationId: z
    .union([z.string().uuid(), z.literal(""), z.null()])
    .optional()
    .transform((value) => value || null),
  storageDetail: nullableText,
  packageState: z.enum(PACKAGE_STATES).default("unknown"),
  bestBefore: z
    .union([z.string().date(), z.literal(""), z.null()])
    .optional()
    .transform((value) => value || null),
  priority: z.enum(INVENTORY_PRIORITIES).default("normal"),
  notes: nullableText,
});

export const consumeInventoryInput = z.object({
  action: z.literal("consume"),
  amount: z.coerce.number().positive().max(1_000_000),
  reason: z.string().trim().max(300).optional(),
  addToShopping: z.boolean().optional().default(false),
});

export const inventoryBulkPatch = z
  .object({
    category: z.string().trim().min(1).max(100).optional(),
    unit: z.string().trim().max(500).nullable().optional(),
    storageLocationId: z.string().uuid().nullable().optional(),
    storageDetail: z.string().trim().max(500).nullable().optional(),
    packageState: z.enum(PACKAGE_STATES).optional(),
    bestBefore: z.string().date().nullable().optional(),
    priority: z.enum(INVENTORY_PRIORITIES).optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Choose at least one field to change");

const inventoryIds = z.array(z.string().uuid()).min(1).max(500);
export const inventoryBulkInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), ids: inventoryIds, patch: inventoryBulkPatch }),
  z.object({
    action: z.literal("archive"),
    ids: inventoryIds,
    addToShopping: z.boolean().optional().default(false),
  }),
]);

export const shoppingInput = z.object({
  item: z.string().trim().min(1).max(200),
  category: nullableText,
  quantity: nullableNumber,
  unit: nullableText,
  status: z.enum(SHOPPING_STATUSES).default("to_buy"),
  notes: nullableText,
});

export const shoppingPatch = z.object({
  item: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().max(500).nullable().optional(),
  quantity: optionalNullableNumber,
  unit: z.string().trim().max(500).nullable().optional(),
  status: z.enum(SHOPPING_STATUSES).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const shoppingBulkStatusInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  status: z.enum(["to_buy", "purchased"]),
});

export const householdTimezoneInput = z.object({
  timeZone: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en-CA", { timeZone: value }).format();
        return true;
      } catch {
        return false;
      }
    }, "Choose a valid IANA time zone"),
});

export const mealInput = z.object({
  mealDate: z.string().date(),
  mealType: z.enum(MEAL_TYPES),
  assignedUserId: z
    .union([z.string().uuid(), z.literal(""), z.null()])
    .optional()
    .transform((value) => value || null),
  dish: z.string().trim().min(1).max(300),
  plannedYield: nullableText,
  packedLunch: z.coerce.boolean().optional().default(false),
  status: z.enum(MEAL_STATUSES).default("planned"),
  notes: nullableText,
});

export const mealPatch = z.object({
  mealDate: z.string().date().optional(),
  mealType: z.enum(MEAL_TYPES).optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
  dish: z.string().trim().min(1).max(300).optional(),
  plannedYield: z.string().trim().max(500).nullable().optional(),
  packedLunch: z.boolean().nullable().optional(),
  status: z.enum(MEAL_STATUSES).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const mealInventoryReviewInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("dismiss") }),
  z
    .object({
      action: z.literal("apply"),
      items: z
        .array(
          z.object({
            inventoryEntryId: z.string().uuid(),
            amount: z.coerce
              .number()
              .positive()
              .max(1_000_000)
              .transform((value) => Math.round((value + Number.EPSILON) * 1_000) / 1_000),
            unit: z.string().trim().max(100).nullable(),
            addToShopping: z.boolean().optional().default(false),
          }),
        )
        .min(1)
        .max(200),
    })
    .superRefine((value, context) => {
      const ids = new Set<string>();
      value.items.forEach((item, index) => {
        if (ids.has(item.inventoryEntryId))
          context.addIssue({
            code: "custom",
            message: "Each inventory item can only be updated once",
            path: ["items", index, "inventoryEntryId"],
          });
        ids.add(item.inventoryEntryId);
      });
    }),
]);

export const feedbackInput = z.object({
  feedbackDate: z.string().date(),
  userId: z
    .union([z.string().uuid(), z.literal(""), z.null()])
    .optional()
    .transform((value) => value || null),
  recipeId: z
    .union([z.string().uuid(), z.literal(""), z.null()])
    .optional()
    .transform((value) => value || null),
  dish: z.string().trim().min(1).max(300),
  rating: z.enum(FEEDBACK_RATINGS),
  feedback: z.string().trim().min(1).max(2000),
  nextTimeChanges: nullableText,
  repeatDecision: nullableText,
});

export const unscheduledInput = z.object({
  weekStart: z.string().date(),
  itemType: z.enum(MEAL_TYPES),
  assignedUserId: z
    .union([z.string().uuid(), z.literal(""), z.null()])
    .optional()
    .transform((value) => value || null),
  title: z.string().trim().min(1).max(300),
  plannedYield: nullableText,
  status: z.enum(MEAL_STATUSES).default("planned"),
  notes: nullableText,
});

export const unscheduledPatch = z.object({
  weekStart: z.string().date().optional(),
  itemType: z.enum(MEAL_TYPES).optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(300).optional(),
  plannedYield: z.string().trim().max(500).nullable().optional(),
  status: z.enum(MEAL_STATUSES).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const scheduleUnscheduledInput = z.object({
  mealDate: z.string().date(),
  mealType: z.enum(MEAL_TYPES),
  assignedUserId: z
    .union([z.string().uuid(), z.literal(""), z.null()])
    .optional()
    .transform((value) => value || null),
  packedLunch: z.coerce.boolean().optional().default(false),
});

const registrationLine = z.discriminatedUnion("action", [
  z.object({
    shoppingItemId: z.string().uuid(),
    action: z.literal("register"),
    category: z.string().trim().min(1).max(100),
    quantity: z.coerce
      .number()
      .positive()
      .max(999_999_999.999)
      .transform((value) => Math.round((value + Number.EPSILON) * 1_000) / 1_000),
    unit: nullableText,
    storageLocationId: z
      .union([z.string().uuid(), z.literal(""), z.null()])
      .optional()
      .transform((value) => value || null),
    inventoryEntryId: z
      .union([z.string().uuid(), z.literal(""), z.null()])
      .optional()
      .transform((value) => value || null),
    storageDetail: nullableText,
    packageState: z.enum(PACKAGE_STATES).default("sealed"),
    priority: z.enum(INVENTORY_PRIORITIES).default("normal"),
    notes: nullableText,
  }),
  z.object({
    shoppingItemId: z.string().uuid(),
    action: z.literal("defer"),
  }),
]);

export const groceryRegistrationInput = z
  .object({
    items: z.array(registrationLine).min(1).max(200),
  })
  .superRefine((value, context) => {
    const ids = new Set<string>();
    value.items.forEach((item, index) => {
      if (ids.has(item.shoppingItemId)) {
        context.addIssue({
          code: "custom",
          message: "Each shopping item can only be registered once",
          path: ["items", index, "shoppingItemId"],
        });
      }
      ids.add(item.shoppingItemId);
    });
  });
