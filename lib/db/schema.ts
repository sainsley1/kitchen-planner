import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["owner", "member"]);
export const inventoryPriority = pgEnum("inventory_priority", ["normal", "use_soon", "use_now", "reserved"]);
export const packageState = pgEnum("package_state", ["sealed", "opened", "full", "partial", "nearly_empty", "unknown"]);
export const mealType = pgEnum("meal_type", ["breakfast", "lunch", "dinner", "snack", "dessert", "prep"]);
export const mealStatus = pgEnum("meal_status", ["planned", "completed", "changed", "deferred", "skipped", "open", "unconfirmed"]);
export const shoppingStatus = pgEnum("shopping_status", ["to_buy", "purchased", "deferred", "removed"]);
export const preferenceStatus = pgEnum("preference_status", ["active", "contextual", "superseded"]);
export const auditSource = pgEnum("audit_source", ["ui", "ai", "import", "system"]);
export const importStatus = pgEnum("import_status", ["pending", "valid", "warning", "rejected", "committed"]);
export const aiWorkflow = pgEnum("ai_workflow", ["quick_update", "feedback_learning", "grocery_registration", "weekly_planning", "recipe_import", "flyer_extraction"]);
export const aiJobStatus = pgEnum("ai_job_status", ["queued", "running", "completed", "failed", "cancelled"]);
export const aiProposalStatus = pgEnum("ai_proposal_status", ["pending", "approved", "rejected", "expired"]);

export const households = pgTable("households", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("America/Vancouver"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const householdUsers = pgTable("household_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  role: userRole("role").notNull().default("member"),
  pinHash: text("pin_hash"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("household_user_name_uq").on(table.householdId, table.displayName)]);

export const appSessions = pgTable("app_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => householdUsers.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("app_session_token_uq").on(table.tokenHash), index("app_session_user_idx").on(table.userId)]);

export const storageLocations = pgTable("storage_locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  detail: text("detail"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
}, (table) => [uniqueIndex("storage_location_uq").on(table.householdId, table.name, table.detail)]);

export const inventoryEntries = pgTable("inventory_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  ingredient: text("ingredient").notNull(),
  brandVariety: text("brand_variety"),
  category: text("category").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }),
  unit: text("unit"),
  storageLocationId: uuid("storage_location_id").references(() => storageLocations.id, { onDelete: "set null" }),
  storageDetail: text("storage_detail"),
  packageState: packageState("package_state").notNull().default("unknown"),
  bestBefore: date("best_before"),
  priority: inventoryPriority("priority").notNull().default("normal"),
  notes: text("notes"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  legacySource: jsonb("legacy_source"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("inventory_household_idx").on(table.householdId),
  index("inventory_priority_idx").on(table.householdId, table.priority),
]);

export const recipes = pgTable("recipes", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  sourceUrl: text("source_url"),
  plannedYield: text("planned_yield"),
  tags: text("tags").array().notNull().default([]),
  notes: text("notes"),
  sourceType: text("source_type").notNull().default("external_link"),
  description: text("description"),
  cuisine: text("cuisine"),
  mealTypes: text("meal_types").array().notNull().default([]),
  servings: integer("servings"),
  prepMinutes: integer("prep_minutes"),
  cookMinutes: integer("cook_minutes"),
  ingredients: jsonb("ingredients").notNull().default([]),
  instructions: jsonb("instructions").notNull().default([]),
  favorite: boolean("favorite").notNull().default(false),
  recipeStatus: text("recipe_status").notNull().default("proven"),
  freezerFriendly: boolean("freezer_friendly").notNull().default(false),
  leftoverFriendly: boolean("leftover_friendly").notNull().default(false),
  packedLunchFriendly: boolean("packed_lunch_friendly").notNull().default(false),
  createdBy: uuid("created_by").references(() => householdUsers.id, { onDelete: "set null" }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("recipes_active_household_idx").on(table.householdId,table.favorite,table.updatedAt)]);

export const flyerSources = pgTable("flyer_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  storeName: text("store_name").notNull(),
  storeLocation: text("store_location"),
  validFrom: date("valid_from").notNull(),
  validUntil: date("valid_until").notNull(),
  sourceType: text("source_type").notNull(),
  sourceUrl: text("source_url"),
  originalFilename: text("original_filename"),
  mimeType: text("mime_type"),
  storagePath: text("storage_path"),
  sourceChecksum: text("source_checksum"),
  status: text("status").notNull().default("review"),
  extractionWarnings: jsonb("extraction_warnings").notNull().default([]),
  createdBy: uuid("created_by").references(() => householdUsers.id, { onDelete: "set null" }),
  committedBy: uuid("committed_by").references(() => householdUsers.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  committedAt: timestamp("committed_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [index("flyer_sources_household_dates_idx").on(table.householdId,table.status,table.validFrom,table.validUntil)]);

export const flyerSaleItems = pgTable("flyer_sale_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  flyerSourceId: uuid("flyer_source_id").notNull().references(() => flyerSources.id, { onDelete: "cascade" }),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  item: text("item").notNull(),
  brand: text("brand"),
  category: text("category"),
  packageSize: text("package_size"),
  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  regularPrice: numeric("regular_price", { precision: 12, scale: 2 }),
  savingsAmount: numeric("savings_amount", { precision: 12, scale: 2 }),
  discountPercent: numeric("discount_percent", { precision: 6, scale: 2 }),
  pricingUnit: text("pricing_unit"),
  multiBuyQuantity: integer("multi_buy_quantity"),
  memberOnly: boolean("member_only").notNull().default(false),
  limitText: text("limit_text"),
  notes: text("notes"),
  confidence: numeric("confidence", { precision: 4, scale: 3 }),
  evidenceText: text("evidence_text"),
  sourceReference: text("source_reference"),
  status: text("status").notNull().default("proposed"),
  prioritized: boolean("prioritized").notNull().default(false),
  normalizedUnitPrice: numeric("normalized_unit_price", { precision: 10, scale: 2 }),
  normalizedUnitMeasure: text("normalized_unit_measure"),
  estimatedRegularPrice: numeric("estimated_regular_price", { precision: 10, scale: 2 }),
  dealGrade: text("deal_grade"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("flyer_sale_items_source_idx").on(table.flyerSourceId,table.status,table.item),index("flyer_sale_items_active_lookup_idx").on(table.householdId,table.status,table.item)]);

export const flyerItemPriceHistory = pgTable("flyer_item_price_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  flyerSourceId: uuid("flyer_source_id").notNull().references(() => flyerSources.id, { onDelete: "cascade" }),
  flyerSaleItemId: uuid("flyer_sale_item_id").notNull().references(() => flyerSaleItems.id, { onDelete: "cascade" }),
  item: text("item").notNull(),
  normalizedIngredient: text("normalized_ingredient").notNull(),
  storeName: text("store_name").notNull(),
  storeLocation: text("store_location"),
  salePrice: numeric("sale_price", { precision: 10, scale: 2 }).notNull(),
  regularPrice: numeric("regular_price", { precision: 10, scale: 2 }),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }),
  unitMeasure: text("unit_measure"),
  validFrom: date("valid_from").notNull(),
  validUntil: date("valid_until").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const foodPreferences = pgTable("food_preferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => householdUsers.id, { onDelete: "cascade" }),
  topic: text("topic").notNull(),
  classification: text("classification").notNull(),
  detail: text("detail").notNull(),
  context: text("context"),
  status: preferenceStatus("status").notNull().default("active"),
  effectiveDate: date("effective_date").notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const mealPlanEntries = pgTable("meal_plan_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  mealDate: date("meal_date").notNull(),
  mealType: mealType("meal_type").notNull(),
  assignedUserId: uuid("assigned_user_id").references(() => householdUsers.id, { onDelete: "set null" }),
  dish: text("dish").notNull(),
  recipeId: uuid("recipe_id").references(() => recipes.id, { onDelete: "set null" }),
  plannedYield: text("planned_yield"),
  packedLunch: boolean("packed_lunch"),
  leftoverPrepLink: text("leftover_prep_link"),
  status: mealStatus("status").notNull().default("planned"),
  notes: text("notes"),
  legacySource: jsonb("legacy_source"),
  weeklyPlanId: uuid("weekly_plan_id"),
  weeklyPlanMealId: text("weekly_plan_meal_id"),
  plannedInventoryUses: jsonb("planned_inventory_uses").notNull().default([]),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("meal_plan_date_idx").on(table.householdId, table.mealDate)]);

export const mealDayInventoryReviews = pgTable("meal_day_inventory_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  mealDate: date("meal_date").notNull(),
  suggestions: jsonb("suggestions").notNull().default([]),
  status: text("status").notNull().default("pending"),
  createdBy: uuid("created_by").references(() => householdUsers.id, { onDelete: "set null" }),
  resolvedBy: uuid("resolved_by").references(() => householdUsers.id, { onDelete: "set null" }),
  resolution: jsonb("resolution"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (table) => [index("meal_day_inventory_reviews_household_status_idx").on(table.householdId,table.status,table.mealDate)]);

export const unscheduledItems = pgTable("unscheduled_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  weekStart: date("week_start").notNull(),
  itemType: mealType("item_type").notNull().default("prep"),
  assignedUserId: uuid("assigned_user_id").references(() => householdUsers.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  recipeId: uuid("recipe_id").references(() => recipes.id, { onDelete: "set null" }),
  plannedYield: text("planned_yield"),
  status: mealStatus("status").notNull().default("planned"),
  notes: text("notes"),
  legacySource: jsonb("legacy_source"),
  sourceMealPlanEntryId: uuid("source_meal_plan_entry_id").references(() => mealPlanEntries.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("unscheduled_household_week_idx").on(table.householdId, table.weekStart, table.status, table.itemType),
  uniqueIndex("unscheduled_source_meal_uq").on(table.sourceMealPlanEntryId),
]);

export const mealFeedback = pgTable("meal_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => householdUsers.id, { onDelete: "set null" }),
  recipeId: uuid("recipe_id").references(() => recipes.id, { onDelete: "set null" }),
  mealPlanEntryId: uuid("meal_plan_entry_id").references(() => mealPlanEntries.id, { onDelete: "set null" }),
  feedbackDate: date("feedback_date").notNull(),
  dish: text("dish").notNull(),
  rating: text("rating").notNull(),
  feedback: text("feedback").notNull(),
  nextTimeChanges: text("next_time_changes"),
  repeatDecision: text("repeat_decision"),
  legacySource: jsonb("legacy_source"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shoppingItems = pgTable("shopping_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  item: text("item").notNull(),
  category: text("category"),
  quantity: numeric("quantity", { precision: 12, scale: 3 }),
  unit: text("unit"),
  status: shoppingStatus("status").notNull().default("to_buy"),
  notes: text("notes"),
  inventoryEntryId: uuid("inventory_entry_id").references(() => inventoryEntries.id, { onDelete: "set null" }),
  weeklyPlanId: uuid("weekly_plan_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const stapleTargets = pgTable("staple_targets", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  ingredient: text("ingredient").notNull(),
  category: text("category"),
  targetMinimum: numeric("target_minimum", { precision: 12, scale: 3 }),
  unit: text("unit"),
  preferredBrand: text("preferred_brand"),
  currentStatus: text("current_status"),
  reorderRule: text("reorder_rule"),
  notes: text("notes"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => householdUsers.id, { onDelete: "set null" }),
  source: auditSource("source").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  reason: text("reason"),
  beforeState: jsonb("before_state"),
  afterState: jsonb("after_state"),
  idempotencyKey: text("idempotency_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("audit_idempotency_uq").on(table.householdId, table.idempotencyKey)]);

export const importBatches = pgTable("import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  sourceFilename: text("source_filename").notNull(),
  sourceChecksum: text("source_checksum").notNull(),
  dryRun: boolean("dry_run").notNull().default(true),
  status: importStatus("status").notNull().default("pending"),
  sourceRows: integer("source_rows").notNull().default(0),
  acceptedRows: integer("accepted_rows").notNull().default(0),
  warningRows: integer("warning_rows").notNull().default(0),
  rejectedRows: integer("rejected_rows").notNull().default(0),
  reconciliationRows: integer("reconciliation_rows").notNull().default(0),
  resolvedRows: integer("resolved_rows").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  committedBy: uuid("committed_by").references(() => householdUsers.id, { onDelete: "set null" }),
  committedAt: timestamp("committed_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const importRows = pgTable("import_rows", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id").notNull().references(() => importBatches.id, { onDelete: "cascade" }),
  sourceSheet: text("source_sheet").notNull(),
  sourceRow: integer("source_row").notNull(),
  status: importStatus("status").notNull().default("pending"),
  rawPayload: jsonb("raw_payload").notNull(),
  normalizedPayload: jsonb("normalized_payload"),
  messages: jsonb("messages").notNull().default([]),
  destinationType: text("destination_type"),
  requiresReconciliation: boolean("requires_reconciliation").notNull().default(false),
  suggestedAction: text("suggested_action"),
  duplicateCandidates: jsonb("duplicate_candidates").notNull().default([]),
  resolutionAction: text("resolution_action"),
  resolutionPayload: jsonb("resolution_payload"),
  resolutionTargetId: uuid("resolution_target_id"),
  resolvedBy: uuid("resolved_by").references(() => householdUsers.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  committedEntityType: text("committed_entity_type"),
  committedEntityId: uuid("committed_entity_id"),
});

export const cutoverRuns = pgTable("cutover_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  batchId: uuid("batch_id").notNull().references(() => importBatches.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => householdUsers.id, { onDelete: "set null" }),
  status: text("status").notNull(),
  backupReference: text("backup_reference").notNull(),
  beforeCounts: jsonb("before_counts").notNull().default({}),
  resultCounts: jsonb("result_counts").notNull().default({}),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const appSettings = pgTable("app_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("app_setting_key_uq").on(table.householdId, table.key)]);

export const aiJobs = pgTable("ai_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => householdUsers.id, { onDelete: "set null" }),
  workflow: aiWorkflow("workflow").notNull(),
  status: aiJobStatus("status").notNull().default("queued"),
  inputText: text("input_text"),
  inputSnapshot: jsonb("input_snapshot").notNull().default({}),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  retryOfJobId: uuid("retry_of_job_id").references((): any => aiJobs.id, { onDelete: "set null" }),
  fallbackReason: text("fallback_reason"),
  cancelRequested: boolean("cancel_requested").notNull().default(false),
}, (table) => [index("ai_jobs_household_created_idx").on(table.householdId, table.createdAt)]);

export const aiRuns = pgTable("ai_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => aiJobs.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("openai"),
  model: text("model").notNull(),
  reasoningEffort: text("reasoning_effort").notNull(),
  promptVersion: text("prompt_version").notNull(),
  responseId: text("response_id"),
  status: text("status").notNull(),
  inputTokens: integer("input_tokens"),
  cachedInputTokens: integer("cached_input_tokens"),
  outputTokens: integer("output_tokens"),
  totalTokens: integer("total_tokens"),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 6 }),
  latencyMs: integer("latency_ms"),
  webSearchCalls: integer("web_search_calls").notNull().default(0),
  webSourceCount: integer("web_source_count").notNull().default(0),
  errorMessage: text("error_message"),
  modelTier: text("model_tier").notNull().default("primary"),
  triggerReason: text("trigger_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [index("ai_runs_job_idx").on(table.jobId, table.createdAt)]);

export const aiProposals = pgTable("ai_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").notNull().references(() => aiJobs.id, { onDelete: "cascade" }),
  workflow: aiWorkflow("workflow").notNull(),
  status: aiProposalStatus("status").notNull().default("pending"),
  payload: jsonb("payload").notNull(),
  selectedActionIds: jsonb("selected_action_ids").notNull().default([]),
  resultPayload: jsonb("result_payload"),
  approvedBy: uuid("approved_by").references(() => householdUsers.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedBy: uuid("rejected_by").references(() => householdUsers.id, { onDelete: "set null" }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("ai_proposals_job_uq").on(table.jobId),
  index("ai_proposals_household_status_idx").on(table.householdId, table.status, table.createdAt),
]);

export const weeklyPlans = pgTable("weekly_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").notNull().references(() => aiJobs.id, { onDelete: "cascade" }),
  parentPlanId: uuid("parent_plan_id"),
  createdBy: uuid("created_by").references(() => householdUsers.id, { onDelete: "set null" }),
  committedBy: uuid("committed_by").references(() => householdUsers.id, { onDelete: "set null" }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  startMeal: mealType("start_meal").notNull().default("breakfast"),
  endMeal: mealType("end_meal").notNull().default("dinner"),
  includeSnacks: boolean("include_snacks").notNull().default(true),
  includeDesserts: boolean("include_desserts").notNull().default(true),
  discoverRecipes: boolean("discover_recipes").notNull().default(true),
  status: text("status").notNull().default("draft"),
  originalRequest: text("original_request"),
  normalizedRequest: text("normalized_request"),
  currentPayload: jsonb("current_payload").notNull(),
  validationIssues: jsonb("validation_issues").notNull().default([]),
  revisionNumber: integer("revision_number").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  committedAt: timestamp("committed_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("weekly_plans_job_uq").on(table.jobId),
  index("weekly_plans_household_status_idx").on(table.householdId,table.status,table.createdAt),
]);

export const weeklyPlanRevisions = pgTable("weekly_plan_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  weeklyPlanId: uuid("weekly_plan_id").notNull().references(() => weeklyPlans.id, { onDelete: "cascade" }),
  revisionNumber: integer("revision_number").notNull(),
  payload: jsonb("payload").notNull(),
  validationIssues: jsonb("validation_issues").notNull().default([]),
  source: text("source").notNull(),
  summary: text("summary").notNull().default("Plan revision"),
  changeDetail: jsonb("change_detail").notNull().default({}),
  createdBy: uuid("created_by").references(() => householdUsers.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("weekly_plan_revision_uq").on(table.weeklyPlanId,table.revisionNumber),
  index("weekly_plan_revisions_plan_idx").on(table.weeklyPlanId,table.revisionNumber),
]);

export const weeklyPlanRecipeSources = pgTable("weekly_plan_recipe_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  weeklyPlanId: uuid("weekly_plan_id").notNull().references(() => weeklyPlans.id, { onDelete: "cascade" }),
  sourceUrl: text("source_url").notNull(),
  sourceTitle: text("source_title"),
  sourceDomain: text("source_domain").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("weekly_plan_recipe_source_uq").on(table.weeklyPlanId,table.sourceUrl),
  index("weekly_plan_recipe_sources_plan_idx").on(table.weeklyPlanId,table.verifiedAt),
]);

export const weeklyPlanSuggestions = pgTable("weekly_plan_suggestions", {
  id: uuid("id").primaryKey().defaultRandom(),
  weeklyPlanId: uuid("weekly_plan_id").notNull().references(() => weeklyPlans.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").notNull().references(() => aiJobs.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  targetMealId: text("target_meal_id").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("pending"),
  createdBy: uuid("created_by").references(() => householdUsers.id, { onDelete: "set null" }),
  appliedBy: uuid("applied_by").references(() => householdUsers.id, { onDelete: "set null" }),
  selectedOptionId: text("selected_option_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [index("weekly_plan_suggestions_plan_idx").on(table.weeklyPlanId,table.status,table.createdAt)]);
