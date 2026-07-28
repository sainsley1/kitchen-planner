import { z } from "zod";
import {
  FEEDBACK_RATINGS,
  INVENTORY_PRIORITIES,
  MEAL_TYPES,
  PACKAGE_STATES,
  SHOPPING_STATUSES,
} from "@/lib/options";

const nullableText = z.string().max(2000).nullable();
const nullableId = z.string().nullable();
const nullableNumber = z.number().nonnegative().max(999_999_999.999).nullable();
// OpenAI Structured Outputs does not accept JSON Schema's `format: "uri"`.
// A regex preserves the HTTP(S)-only contract while emitting the supported
// `pattern` keyword instead of the unsupported URI format annotation.
const httpUrl = z
  .string()
  .max(2000)
  .regex(/^https?:\/\/\S+$/)
  .refine(
    (value) => {
      try {
        return ["http:", "https:"].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    },
    { message: "Recipe URL must be an absolute HTTP(S) URL" },
  );

// Kept as a small, explicit safety contract for callers and regression tests.
// Natural-language instructions are never sufficient on their own: a mutation
// must identify the scoped inventory record and pass through proposal review.
export const inventoryAdjustmentSchema = z.object({
  inventoryEntryId: z.string().uuid(),
  operation: z.enum(["set", "add", "subtract"]),
  quantity: z.number().positive().max(999_999_999.999),
  unit: z.string().min(1).max(100).nullable(),
  reason: z.string().min(1).max(1000),
});

export const mutationPolicy = { requiresPreview: true, arbitrarySqlAllowed: false } as const;

export const aiTextInput = z.object({ text: z.string().trim().min(2).max(4000) });
export const groceryRecommendationInput = z.object({
  shoppingItemIds: z.array(z.string().uuid()).min(1).max(100),
});
export const aiFallbackRetryInput = z.object({ fallbackOfJobId: z.string().uuid() });
export const aiTextRequest = z.union([aiTextInput, aiFallbackRetryInput]);
export const groceryRecommendationRequest = z.union([
  groceryRecommendationInput,
  aiFallbackRetryInput,
]);
export const englishNormalizationSchema = z.object({
  detectedLanguage: z.string().trim().min(2).max(100),
  wasTranslated: z.boolean(),
  normalizedEnglish: z.string().trim().min(2).max(4000),
});
export const weeklyNotesNormalizationSchema = z.object({
  detectedLanguage: z.string().trim().min(2).max(100),
  wasTranslated: z.boolean(),
  normalizedEnglish: z.string().trim().min(2).max(8000),
});

const planningBoundaryMeal = z.enum(["breakfast", "lunch", "dinner"]);
export const weeklyPlanRequestSchema = z
  .object({
    startDate: z.string().date(),
    endDate: z.string().date(),
    startMeal: planningBoundaryMeal.default("breakfast"),
    endMeal: planningBoundaryMeal.default("dinner"),
    planningMode: z.enum(["balanced", "deep"]).default("balanced"),
    notes: z.string().trim().max(8000).default(""),
    includeSnacks: z.boolean().default(true),
    includeDesserts: z.boolean().default(true),
    discoverRecipes: z.boolean().default(true),
  })
  .superRefine((value, context) => {
    const start = new Date(`${value.startDate}T00:00:00Z`);
    const end = new Date(`${value.endDate}T00:00:00Z`);
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    if (days < 1 || days > 10)
      context.addIssue({
        code: "custom",
        message: "Plan between 1 and 10 calendar days",
        path: ["endDate"],
      });
    const order = { breakfast: 0, lunch: 1, dinner: 2 };
    if (value.startDate === value.endDate && order[value.startMeal] > order[value.endMeal])
      context.addIssue({
        code: "custom",
        message: "The final meal must not come before the first meal",
        path: ["endMeal"],
      });
  });

export const weeklyPlanInventoryUseSchema = z.object({
  inventoryEntryId: z.string().uuid(),
  ingredient: z.string().min(1).max(200),
  quantity: z.number().positive().max(999_999.999).nullable(),
  unit: z.string().max(100).nullable(),
});

export const weeklyPlanIngredientRequirementSchema = z.object({
  item: z.string().trim().min(1).max(300),
  category: z.string().trim().min(1).max(100),
  quantity: z.number().positive().max(999_999.999).nullable(),
  unit: z.string().trim().max(100).nullable(),
  optional: z.boolean(),
  inventoryEntryId: z.string().uuid().nullable().default(null),
});

export const weeklyPlanMealSchema = z.object({
  id: z.string().min(1).max(100),
  mealDate: z.string().date(),
  mealType: z.enum(MEAL_TYPES),
  assignedUserId: z.string().uuid().nullable(),
  dish: z.string().min(1).max(300),
  cuisine: z.string().min(1).max(100),
  technique: z.string().min(1).max(100).default("unspecified"),
  primaryIngredients: z.array(z.string().trim().min(1).max(100)).max(12).default([]),
  preparationBasis: z
    .enum([
      "saved_recipe",
      "verified_recipe",
      "guided_method",
      "assembly",
      "prepared_food",
      "leftover",
    ])
    .default("guided_method"),
  preparationMethod: z.string().trim().max(2000).nullable().default(null),
  ingredientRequirements: z.array(weeklyPlanIngredientRequirementSchema).max(100).default([]),
  saleItemIds: z.array(z.string().uuid()).max(20).default([]),
  discovery: z.boolean().default(false),
  recipeId: z.string().uuid().nullable().default(null),
  recipeTitle: z.string().min(1).max(300).nullable(),
  recipeUrl: httpUrl.nullable(),
  servings: z.number().int().positive().max(40),
  leftoverServings: z.number().int().nonnegative().max(40),
  leftoverFromMealId: z.string().max(100).nullable(),
  packedLunch: z.boolean(),
  workplaceMeal: z.boolean(),
  workplaceFriendly: z.boolean(),
  intensity: z.enum(["light", "moderate", "substantial"]),
  prepMinutes: z.number().int().nonnegative().max(720),
  plannedYield: z.string().min(1).max(200),
  rationale: z.string().min(1).max(1000),
  notes: z.string().max(1000).nullable(),
  unscheduledItemId: z.string().uuid().nullable(),
  inventoryUses: z.array(weeklyPlanInventoryUseSchema).max(30),
});

export const weeklyPlanCoverageExceptionSchema = z.object({
  id: z.string().min(1).max(100),
  mealDate: z.string().date(),
  mealType: planningBoundaryMeal,
  userId: z.string().uuid(),
  reason: z.string().min(1).max(500),
});

export const weeklyPlanShoppingSchema = z.object({
  id: z.string().min(1).max(100),
  item: z.string().min(1).max(200),
  requirementKey: z.string().min(1).max(500).nullable().optional(),
  category: z.string().min(1).max(100),
  quantity: z.number().positive().max(999_999.999).nullable(),
  unit: z.string().max(100).nullable(),
  reason: z.string().min(1).max(1000),
  mealIds: z.array(z.string().min(1).max(100)).max(30),
  suggestedStore: z.string().max(200).nullable().default(null),
  saleItemId: z.string().uuid().nullable().default(null),
  estimatedPrice: z.number().nonnegative().max(999_999.99).nullable().default(null),
});

export const weeklyPlanShoppingDecisionSchema = z.object({
  requirementKey: z.string().min(1).max(500),
  item: z.string().min(1).max(200),
  unit: z.string().max(100).nullable(),
  mealIds: z.array(z.string().min(1).max(100)).max(30),
  action: z.enum(["exclude", "inventory"]),
  inventoryEntryId: z.string().uuid().nullable(),
});

export const weeklyPlanReviewScorecardSchema = z.object({
  qualifiedSalesConsidered: z.number().int().nonnegative(),
  prioritySalesConsidered: z.number().int().nonnegative(),
  saleItemIdsUsed: z.array(z.string().uuid()).max(100),
  saleLinkedMealIds: z.array(z.string().min(1).max(100)).max(100),
  useNowInventoryIdsUsed: z.array(z.string().uuid()).max(300),
  useSoonInventoryIdsUsed: z.array(z.string().uuid()).max(300),
  recentRepeats: z
    .array(
      z.object({
        mealId: z.string().min(1).max(100),
        dish: z.string().min(1).max(300),
        recentDish: z.string().min(1).max(300),
        recentDate: z.string().date(),
      }),
    )
    .max(100),
  cuisines: z.array(z.string().min(1).max(100)).max(100),
  techniques: z.array(z.string().min(1).max(100)).max(100),
  primaryIngredients: z.array(z.string().min(1).max(100)).max(200),
  discoveryMealIds: z.array(z.string().min(1).max(100)).max(100),
  familiarMealIds: z.array(z.string().min(1).max(100)).max(100),
});

export const weeklyPlanSchema = z.object({
  planFormatVersion: z.number().int().min(1).max(2).default(1),
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(1500),
  strategy: z.string().min(1).max(3000),
  meals: z.array(weeklyPlanMealSchema).min(1).max(100),
  coverageExceptions: z.array(weeklyPlanCoverageExceptionSchema).max(50),
  shopping: z.array(weeklyPlanShoppingSchema).max(200),
  shoppingDecisions: z.array(weeklyPlanShoppingDecisionSchema).max(200).default([]),
  prepTasks: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        task: z.string().min(1).max(500),
        mealDate: z.string().date(),
        minutes: z.number().int().nonnegative().max(720),
        mealIds: z.array(z.string().min(1).max(100)).max(30),
      }),
    )
    .max(50),
  warnings: z.array(z.string().max(500)).max(30),
  reviewScorecard: weeklyPlanReviewScorecardSchema.default({
    qualifiedSalesConsidered: 0,
    prioritySalesConsidered: 0,
    saleItemIdsUsed: [],
    saleLinkedMealIds: [],
    useNowInventoryIdsUsed: [],
    useSoonInventoryIdsUsed: [],
    recentRepeats: [],
    cuisines: [],
    techniques: [],
    primaryIngredients: [],
    discoveryMealIds: [],
    familiarMealIds: [],
  }),
});

/**
 * Keep the model-owned weekly-plan response smaller than the persisted plan.
 * Shopping, inventory-use allocation, and the review scorecard are rebuilt
 * deterministically from complete ingredient requirements and current
 * household data after generation.
 */
export const weeklyPlanGenerationMealSchema = weeklyPlanMealSchema
  .omit({ inventoryUses: true })
  .extend({
    preparationMethod: z.string().trim().max(1200).nullable().default(null),
    rationale: z.string().min(1).max(500),
    notes: z.string().max(500).nullable(),
  });
export const weeklyPlanGenerationSchema = weeklyPlanSchema
  .omit({
    planFormatVersion: true,
    meals: true,
    shopping: true,
    shoppingDecisions: true,
    reviewScorecard: true,
  })
  .extend({
    summary: z.string().min(1).max(1000),
    strategy: z.string().min(1).max(1500),
    meals: z.array(weeklyPlanGenerationMealSchema).min(1).max(100),
    // The provider occasionally exceeds a JSON Schema maxItems hint. Accept
    // the complete model warning list here; the application de-duplicates and
    // bounds it before applying the stricter persisted-plan schema.
    warnings: z.array(z.string().max(500)),
  });

export const weeklyPlanEditSchema = z.object({ payload: weeklyPlanSchema });
export const weeklyPlanCommitSchema = z.object({ replaceExisting: z.boolean().default(false) });
export const weeklyPlanRestoreSchema = z.object({ revisionNumber: z.number().int().positive() });
export const recipeSourcePreferencesSchema = z.object({
  preferredDomains: z.array(z.string().trim().min(1).max(253)).max(50).default([]),
  blockedDomains: z.array(z.string().trim().min(1).max(253)).max(50).default([]),
  preferSavedRecipes: z.boolean().default(true),
  allowVideoSources: z.boolean().default(false),
  allowPaywalledSources: z.boolean().default(false),
  allowRegistrationSources: z.boolean().default(false),
});
export const weeklyPlanRefinementRequestSchema = z
  .object({
    scope: z.enum(["meal", "person_meal", "day"]),
    mealId: z.string().min(1).max(100).nullable().default(null),
    mealDate: z.string().date().nullable().default(null),
    mealType: planningBoundaryMeal.nullable().default(null),
    userId: z.string().uuid().nullable().default(null),
    instruction: z.string().trim().min(2).max(2000),
    advanced: z.boolean().default(false),
  })
  .superRefine((value, context) => {
    if (value.scope === "meal" && !value.mealId)
      context.addIssue({ code: "custom", message: "Choose a meal", path: ["mealId"] });
    if (value.scope === "person_meal" && (!value.mealDate || !value.mealType || !value.userId))
      context.addIssue({
        code: "custom",
        message: "Choose the person-specific meal",
        path: ["userId"],
      });
    if (value.scope === "day" && !value.mealDate)
      context.addIssue({ code: "custom", message: "Choose a day", path: ["mealDate"] });
  });
export const weeklyPlanRefinementSchema = z.object({
  summary: z.string().min(1).max(500),
  replacementMeals: z.array(weeklyPlanMealSchema).min(1).max(30),
  replacementShopping: z.array(weeklyPlanShoppingSchema).max(100),
  replacementPrepTasks: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        task: z.string().min(1).max(500),
        mealDate: z.string().date(),
        minutes: z.number().int().nonnegative().max(720),
        mealIds: z.array(z.string().min(1).max(100)).max(30),
      }),
    )
    .max(30),
  warnings: z.array(z.string().max(500)).max(20),
});
export const weeklyPlanRefinementGenerationSchema = weeklyPlanRefinementSchema
  .omit({ replacementMeals: true, replacementShopping: true })
  .extend({
    replacementMeals: z.array(weeklyPlanGenerationMealSchema).min(1).max(30),
  });
export const weeklyPlanSuggestionRequestSchema = z.object({
  kind: z.enum(["alternatives", "recipe_link"]),
  mealId: z.string().min(1).max(100),
  instruction: z.string().trim().max(2000).default(""),
  advanced: z.boolean().default(false),
});
export const weeklyPlanAlternativeOptionSchema = z.object({
  id: z.string().min(1).max(100),
  meal: weeklyPlanMealSchema,
  shopping: z.array(weeklyPlanShoppingSchema).max(50),
  shoppingImpact: z.string().min(1).max(500),
  leftoverImpact: z.string().min(1).max(500),
  sourceEvidence: z.string().max(1000).nullable(),
});
export const recipeRequirementSchema = z.object({
  item: z.string().trim().min(1).max(300),
  category: z.string().trim().min(1).max(100),
  quantity: z.number().positive().max(999_999.999).nullable(),
  unit: z.string().trim().max(100).nullable(),
  optional: z.boolean(),
});
export const recipeLinkOptionSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().min(1).max(300),
  url: httpUrl,
  domain: z.string().min(1).max(253),
  matchStatus: z.enum(["exact", "related", "mismatch", "unknown"]),
  prepMinutes: z.number().int().nonnegative().max(720).nullable(),
  yieldText: z.string().max(200).nullable(),
  evidenceSummary: z.string().min(1).max(1000),
  ingredients: z.array(recipeRequirementSchema).min(1).max(200),
  shopping: z.array(weeklyPlanShoppingSchema).max(100),
  shoppingImpact: z.string().min(1).max(500),
  warnings: z.array(z.string().max(500)).max(10),
});
export const weeklyPlanSuggestionSchema = z.object({
  summary: z.string().min(1).max(500),
  alternatives: z.array(weeklyPlanAlternativeOptionSchema).max(3),
  recipeLinks: z.array(recipeLinkOptionSchema).max(3),
  warnings: z.array(z.string().max(500)).max(20),
});
export const weeklyPlanSuggestionGenerationSchema = z.object({
  summary: z.string().min(1).max(500),
  alternatives: z
    .array(
      weeklyPlanAlternativeOptionSchema
        .omit({ meal: true, shopping: true, shoppingImpact: true })
        .extend({ meal: weeklyPlanGenerationMealSchema }),
    )
    .max(3),
  recipeLinks: z
    .array(recipeLinkOptionSchema.omit({ domain: true, shopping: true, shoppingImpact: true }))
    .max(3),
  warnings: z.array(z.string().max(500)).max(20),
});
export const weeklyPlanSuggestionApplySchema = z.object({ optionId: z.string().min(1).max(100) });
export const recipeSourceCheckRequestSchema = z.object({ mealId: z.string().min(1).max(100) });
export const recipeSourceCheckSchema = z.object({
  requestedUrl: httpUrl,
  pageTitle: z.string().max(300).nullable(),
  isAccessible: z.boolean(),
  matchStatus: z.enum(["exact", "related", "mismatch", "unknown"]),
  prepMinutes: z.number().int().nonnegative().max(720).nullable(),
  yieldText: z.string().max(200).nullable(),
  evidenceSummary: z.string().min(1).max(1000),
  warnings: z.array(z.string().max(500)).max(10),
});
export const recipeLinkActionSchema = z
  .object({
    mealId: z.string().min(1).max(100),
    action: z.enum(["saved_recipe", "remove", "keep"]),
    recipeId: z.string().uuid().nullable().default(null),
  })
  .superRefine((value, context) => {
    if (value.action === "saved_recipe" && !value.recipeId)
      context.addIssue({ code: "custom", message: "Choose a saved recipe", path: ["recipeId"] });
  });
export const foodPreferenceInputSchema = z.object({
  userId: z.string().uuid().nullable(),
  topic: z.string().trim().min(1).max(200),
  classification: z.enum([
    "hard_constraint",
    "strong_preference",
    "soft_preference",
    "recipe_lesson",
    "observation",
  ]),
  detail: z.string().trim().min(2).max(2000),
  context: z.string().trim().max(1000).nullable(),
  status: z.enum(["active", "contextual", "superseded"]),
  effectiveDate: z.string().date(),
});

export const recipeIngredientSchema = z.object({
  item: z.string().trim().min(1).max(300),
  quantity: z.number().positive().max(999_999.999).nullable(),
  unit: z.string().trim().max(100).nullable(),
  preparation: z.string().trim().max(300).nullable(),
  optional: z.boolean(),
  notes: z.string().trim().max(500).nullable(),
});
export const recipeInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  sourceType: z.enum(["household", "external_link", "imported_text", "imported_file"]),
  sourceUrl: httpUrl.nullable(),
  description: z.string().trim().max(2000).nullable(),
  cuisine: z.string().trim().max(100).nullable(),
  mealTypes: z.array(z.enum(MEAL_TYPES)).max(6),
  plannedYield: z.string().trim().max(200).nullable(),
  servings: z.number().int().positive().max(100).nullable(),
  prepMinutes: z.number().int().nonnegative().max(1440).nullable(),
  cookMinutes: z.number().int().nonnegative().max(1440).nullable(),
  ingredients: z.array(recipeIngredientSchema).max(200),
  instructions: z.array(z.string().trim().min(1).max(3000)).max(100),
  tags: z.array(z.string().trim().min(1).max(100)).max(50),
  notes: z.string().trim().max(4000).nullable(),
  favorite: z.boolean(),
  recipeStatus: z.enum(["proven", "experimental", "avoid"]),
  freezerFriendly: z.boolean(),
  leftoverFriendly: z.boolean(),
  packedLunchFriendly: z.boolean(),
});
export const recipeImportRequestSchema = z
  .object({
    text: z.string().trim().max(30_000).nullable(),
    sourceUrl: httpUrl.nullable(),
    fileProvided: z.boolean().default(false),
  })
  .superRefine((value, context) => {
    if (!value.text && !value.sourceUrl && !value.fileProvided)
      context.addIssue({
        code: "custom",
        message: "Paste recipe text, provide a URL, or upload a file",
      });
  });
export const recipeImportDraftSchema = recipeInputSchema.extend({
  extractionWarnings: z.array(z.string().max(500)).max(20),
});

export const flyerSourceInputSchema = z
  .object({
    storeName: z.string().trim().min(1).max(200),
    storeLocation: z.string().trim().max(300).nullable(),
    validFrom: z.string().date(),
    validUntil: z.string().date(),
    sourceUrl: httpUrl.nullable(),
  })
  .superRefine((value, context) => {
    if (value.validUntil < value.validFrom)
      context.addIssue({
        code: "custom",
        message: "The final sale date must not precede the first sale date",
        path: ["validUntil"],
      });
  });
const flyerSaleBaseSchema = z.object({
  item: z.string().trim().min(1).max(300),
  brand: z.string().trim().max(200).nullable(),
  category: z.string().trim().max(100).nullable().default(null),
  packageSize: z.string().trim().max(200).nullable(),
  price: z.number().nonnegative().max(999_999.99),
  regularPrice: z.number().nonnegative().max(999_999.99).nullable().default(null),
  savingsAmount: z.number().nonnegative().max(999_999.99).nullable().default(null),
  discountPercent: z.number().nonnegative().max(100).nullable().default(null),
  pricingUnit: z.string().trim().max(100).nullable(),
  multiBuyQuantity: z.number().int().positive().max(100).nullable(),
  memberOnly: z.boolean(),
  limitText: z.string().trim().max(500).nullable(),
  notes: z.string().trim().max(1000).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  evidenceText: z.string().trim().max(1000).nullable(),
  sourceReference: z.string().trim().max(300).nullable(),
  status: z.enum(["proposed", "accepted", "rejected"]),
  prioritized: z.boolean().default(false),
});
type FlyerPriceFields = {
  price: number;
  regularPrice: number | null;
  savingsAmount: number | null;
  multiBuyQuantity: number | null;
};
function isFlyerMultiBuy(value: FlyerPriceFields) {
  return (value.multiBuyQuantity ?? 1) > 1;
}
function comparableFlyerSalePrice(value: FlyerPriceFields) {
  return Number((value.price / (isFlyerMultiBuy(value) ? value.multiBuyQuantity! : 1)).toFixed(2));
}
export const flyerSaleInputSchema = flyerSaleBaseSchema.superRefine((value, context) => {
  const comparableSalePrice = comparableFlyerSalePrice(value);
  if (value.regularPrice != null && value.regularPrice < comparableSalePrice)
    context.addIssue({
      code: "custom",
      message: "Regular price cannot be below the comparable per-unit sale price",
      path: ["regularPrice"],
    });
  if (
    value.savingsAmount != null &&
    value.regularPrice != null &&
    value.savingsAmount > value.regularPrice
  )
    context.addIssue({
      code: "custom",
      message: "Savings cannot exceed the regular price",
      path: ["savingsAmount"],
    });
});
export const flyerExtractionSchema = z.object({
  // Cross-field price integrity is deliberately normalized after Structured
  // Output parsing. A single ambiguous comparison price must not discard an
  // otherwise reviewable flyer containing hundreds of valid rows.
  sales: z
    .array(flyerSaleBaseSchema.omit({ status: true }).extend({ status: z.literal("proposed") }))
    .max(200),
  warnings: z.array(z.string().max(500)).max(30),
});
export type FlyerExtraction = z.infer<typeof flyerExtractionSchema>;

function reducedReviewConfidence(confidence: number | null) {
  return Math.min(confidence ?? 0.5, 0.74);
}
function money(value: number) {
  return `$${value.toFixed(2)}`;
}
function extractionWarning(
  index: number,
  item: string,
  sourceReference: string | null,
  message: string,
) {
  const reference = sourceReference ? ` · ${sourceReference}` : "";
  return `Sale ${index + 1} (${item}${reference}): ${message}`.slice(0, 500);
}

/**
 * Preserve an otherwise useful extraction when one row contains ambiguous
 * price metadata. Multi-buy totals are compared on a per-item basis; genuinely
 * inconsistent comparison fields are cleared and forced below the bulk-accept
 * confidence threshold for explicit household review.
 */
export function normalizeFlyerExtraction(value: unknown): FlyerExtraction {
  const extraction = flyerExtractionSchema.parse(value);
  const integrityWarnings: string[] = [];
  const sales = extraction.sales.map((sale, index) => {
    const comparableSalePrice = comparableFlyerSalePrice(sale);
    if (sale.regularPrice != null && sale.regularPrice < comparableSalePrice) {
      integrityWarnings.push(
        extractionWarning(
          index,
          sale.item,
          sale.sourceReference,
          `regular price ${money(sale.regularPrice)} is below the comparable sale price ${money(comparableSalePrice)}${isFlyerMultiBuy(sale) ? ` per item (${money(sale.price)} for ${sale.multiBuyQuantity})` : ""}; regular price, savings and discount were cleared for manual review.`,
        ),
      );
      return {
        ...sale,
        regularPrice: null,
        savingsAmount: null,
        discountPercent: null,
        confidence: reducedReviewConfidence(sale.confidence),
      };
    }
    if (
      sale.savingsAmount != null &&
      sale.regularPrice != null &&
      sale.savingsAmount > sale.regularPrice
    ) {
      const correctedSavings = Number(
        Math.max(sale.regularPrice - comparableSalePrice, 0).toFixed(2),
      );
      integrityWarnings.push(
        extractionWarning(
          index,
          sale.item,
          sale.sourceReference,
          `advertised savings ${money(sale.savingsAmount)} exceeded regular price ${money(sale.regularPrice)}; savings were recalculated as ${money(correctedSavings)} and require manual review.`,
        ),
      );
      return {
        ...sale,
        savingsAmount: correctedSavings,
        confidence: reducedReviewConfidence(sale.confidence),
      };
    }
    return sale;
  });
  return { sales, warnings: [...integrityWarnings, ...extraction.warnings].slice(0, 30) };
}
export const proposalDecisionInput = z
  .object({ actionIds: z.array(z.string().min(1).max(100)).min(1).max(100) })
  .superRefine((value, context) => {
    if (new Set(value.actionIds).size !== value.actionIds.length)
      context.addIssue({
        code: "custom",
        message: "Each proposed action can only be selected once",
        path: ["actionIds"],
      });
  });

export const quickUpdateActionSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum([
    "inventory_quantity",
    "inventory_move",
    "inventory_create",
    "inventory_archive",
    "shopping_add",
    "shopping_status",
  ]),
  label: z.string().min(1).max(300),
  explanation: z.string().min(1).max(1000),
  inventoryEntryId: nullableId,
  quantityMode: z.enum(["set", "add", "subtract"]).nullable(),
  quantity: nullableNumber,
  ingredient: nullableText,
  brandVariety: nullableText,
  category: nullableText,
  unit: nullableText,
  storageLocationId: nullableId,
  storageDetail: nullableText,
  packageState: z.enum(PACKAGE_STATES).nullable(),
  priority: z.enum(INVENTORY_PRIORITIES).nullable(),
  notes: nullableText,
  addToShopping: z.boolean().nullable(),
  shoppingItemId: nullableId,
  shoppingStatus: z.enum(SHOPPING_STATUSES).nullable(),
});

export const quickUpdateProposalSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(1000),
  warnings: z.array(z.string().max(500)).max(20),
  actions: z.array(quickUpdateActionSchema).min(1).max(50),
});

export const feedbackLearningActionSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(["feedback_create", "preference_create"]),
  label: z.string().min(1).max(300),
  explanation: z.string().min(1).max(1000),
  userId: nullableId,
  feedbackDate: z.string().nullable(),
  dish: nullableText,
  rating: z.enum(FEEDBACK_RATINGS).nullable(),
  feedback: nullableText,
  nextTimeChanges: nullableText,
  repeatDecision: nullableText,
  topic: nullableText,
  classification: z
    .enum([
      "hard_constraint",
      "strong_preference",
      "soft_preference",
      "recipe_lesson",
      "observation",
    ])
    .nullable(),
  detail: nullableText,
  context: nullableText,
  preferenceStatus: z.enum(["active", "contextual"]).nullable(),
});

export const feedbackLearningProposalSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(1000),
  warnings: z.array(z.string().max(500)).max(20),
  actions: z.array(feedbackLearningActionSchema).min(1).max(30),
});

export const groceryRecommendationSchema = z.object({
  suggestions: z
    .array(
      z.object({
        shoppingItemId: z.string(),
        category: z.string().min(1).max(100),
        quantity: z.number().positive().max(999_999_999.999),
        unit: nullableText,
        storageLocationId: nullableId,
        storageDetail: nullableText,
        packageState: z.enum(PACKAGE_STATES),
        priority: z.enum(INVENTORY_PRIORITIES),
        inventoryEntryId: nullableId,
        notes: nullableText,
        explanation: z.string().min(1).max(1000),
      }),
    )
    .min(1)
    .max(100),
  warnings: z.array(z.string().max(500)).max(20),
});

export type QuickUpdateProposal = z.infer<typeof quickUpdateProposalSchema>;
export type FeedbackLearningProposal = z.infer<typeof feedbackLearningProposalSchema>;
export type GroceryRecommendation = z.infer<typeof groceryRecommendationSchema>;
export type WeeklyPlan = z.infer<typeof weeklyPlanSchema>;
export type WeeklyPlanRequest = z.infer<typeof weeklyPlanRequestSchema>;
export type RecipeSourcePreferences = z.infer<typeof recipeSourcePreferencesSchema>;
export type WeeklyPlanSuggestion = z.infer<typeof weeklyPlanSuggestionSchema>;
export type RecipeInput = z.infer<typeof recipeInputSchema>;
export type FlyerSaleInput = z.infer<typeof flyerSaleInputSchema>;
export type AiProposalPayload = QuickUpdateProposal | FeedbackLearningProposal;

function uniqueActionIds(actions: Array<{ id: string }>) {
  const ids = new Set<string>();
  for (const action of actions) {
    if (ids.has(action.id)) throw new Error(`AI returned duplicate action id: ${action.id}`);
    ids.add(action.id);
  }
}

export function validateQuickProposal(
  value: unknown,
  context: { inventoryIds: Set<string>; locationIds: Set<string>; shoppingIds: Set<string> },
): QuickUpdateProposal {
  const proposal = quickUpdateProposalSchema.parse(value);
  uniqueActionIds(proposal.actions);
  for (const action of proposal.actions) {
    if (
      ["inventory_quantity", "inventory_move", "inventory_archive"].includes(action.type) &&
      (!action.inventoryEntryId || !context.inventoryIds.has(action.inventoryEntryId))
    )
      throw new Error(`${action.label}: inventory item is missing or invalid`);
    if (
      action.type === "inventory_quantity" &&
      (!action.quantityMode ||
        action.quantity == null ||
        (action.quantityMode !== "set" && action.quantity <= 0))
    )
      throw new Error(`${action.label}: quantity change is incomplete`);
    if (
      action.type === "inventory_move" &&
      action.storageLocationId &&
      !context.locationIds.has(action.storageLocationId)
    )
      throw new Error(`${action.label}: storage location is invalid`);
    if (
      action.type === "inventory_create" &&
      (!action.ingredient ||
        !action.category ||
        action.quantity == null ||
        action.quantity <= 0 ||
        !action.packageState ||
        !action.priority)
    )
      throw new Error(`${action.label}: new inventory item is incomplete`);
    if (
      action.type === "inventory_create" &&
      action.storageLocationId &&
      !context.locationIds.has(action.storageLocationId)
    )
      throw new Error(`${action.label}: storage location is invalid`);
    if (action.type === "shopping_add" && !action.ingredient)
      throw new Error(`${action.label}: shopping item is missing`);
    if (
      action.type === "shopping_status" &&
      (!action.shoppingItemId ||
        !context.shoppingIds.has(action.shoppingItemId) ||
        !action.shoppingStatus)
    )
      throw new Error(`${action.label}: shopping update is incomplete`);
  }
  return proposal;
}

export function validateFeedbackProposal(
  value: unknown,
  userIds: Set<string>,
): FeedbackLearningProposal {
  const proposal = feedbackLearningProposalSchema.parse(value);
  uniqueActionIds(proposal.actions);
  for (const action of proposal.actions) {
    if (action.userId && !userIds.has(action.userId))
      throw new Error(`${action.label}: household member is invalid`);
    if (
      action.type === "feedback_create" &&
      (!action.feedbackDate ||
        !/^\d{4}-\d{2}-\d{2}$/.test(action.feedbackDate) ||
        !action.dish ||
        !action.rating ||
        !action.feedback)
    )
      throw new Error(`${action.label}: feedback record is incomplete`);
    if (
      action.type === "preference_create" &&
      (!action.topic || !action.classification || !action.detail || !action.preferenceStatus)
    )
      throw new Error(`${action.label}: preference suggestion is incomplete`);
  }
  return proposal;
}

export function validateGroceryRecommendation(
  value: unknown,
  context: { shoppingIds: Set<string>; inventoryIds: Set<string>; locationIds: Set<string> },
): GroceryRecommendation {
  const recommendation = groceryRecommendationSchema.parse(value);
  const seen = new Set<string>();
  let removedInventoryMatches = 0;
  let removedLocations = 0;
  const suggestions = recommendation.suggestions.map((suggestion) => {
    if (seen.has(suggestion.shoppingItemId))
      throw new Error("AI returned duplicate grocery recommendations");
    seen.add(suggestion.shoppingItemId);
    if (!context.shoppingIds.has(suggestion.shoppingItemId))
      throw new Error("AI returned an unknown shopping item");
    const invalidInventory = Boolean(
      suggestion.inventoryEntryId && !context.inventoryIds.has(suggestion.inventoryEntryId),
    );
    const invalidLocation = Boolean(
      suggestion.storageLocationId && !context.locationIds.has(suggestion.storageLocationId),
    );
    if (invalidInventory) removedInventoryMatches += 1;
    if (invalidLocation) removedLocations += 1;
    return {
      ...suggestion,
      inventoryEntryId: invalidInventory ? null : suggestion.inventoryEntryId,
      storageLocationId: invalidLocation ? null : suggestion.storageLocationId,
      explanation: invalidInventory
        ? `${suggestion.explanation} The unrecognized inventory match was cleared; review or create a new inventory entry.`.slice(
            0,
            1000,
          )
        : suggestion.explanation,
    };
  });
  const warnings = [...recommendation.warnings];
  if (removedInventoryMatches)
    warnings.push(
      `${removedInventoryMatches} unrecognized inventory match${removedInventoryMatches === 1 ? " was" : "es were"} cleared safely; review those items before registration.`,
    );
  if (removedLocations)
    warnings.push(
      `${removedLocations} unrecognized storage location${removedLocations === 1 ? " was" : "s were"} cleared safely; choose a location before registration if needed.`,
    );
  return { ...recommendation, suggestions, warnings: warnings.slice(0, 20) };
}
