import "server-only";
import { getPool } from "./client";
import {weeklyPlanSchema,type WeeklyPlan} from "@/lib/ai/contracts";

function poolOrThrow() {
  const pool = getPool();
  if (!pool) throw new Error("Database is not configured");
  return pool;
}

export type InventoryRecord = {
  id: string; ingredient: string; brandVariety: string | null; category: string;
  quantity: string | null; unit: string | null; locationName: string | null;
  storageLocationId: string | null; storageDetail: string | null; packageState: string; bestBefore: string | null;
  priority: string; notes: string | null; updatedAt: string; archivedAt?:string|null;
};

export type StorageLocationRecord = { id: string; name: string; detail: string | null };
export type HouseholdUserRecord = { id: string; displayName: string; role: string };
export type ShoppingRecord = { id: string; item: string; category: string | null; quantity: string | null; unit: string | null; status: string; notes: string | null; inventoryEntryId: string | null };
export type MealRecord = { id: string; mealDate: string; mealType: string; assignedUserId: string | null; assignedName: string | null; dish: string; plannedYield: string | null; packedLunch: boolean | null; status: string; notes: string | null };
export type MealInventoryReviewRecord={id:string;mealDate:string;status:string;createdAt:string;suggestions:Array<{inventoryEntryId:string;ingredient:string;suggestedQuantity:number|null;plannedQuantity:number|null;plannedUnit:string|null;availableQuantity:number;unit:string|null;selectedByDefault:boolean;unitMismatch:boolean;mealEntryIds:string[];dishes:string[]}>};
export type UnscheduledRecord = { id: string; weekStart: string; itemType: string; assignedUserId: string | null; assignedName: string | null; title: string; plannedYield: string | null; status: string; notes: string | null };
export type FeedbackRecord = { id: string; feedbackDate: string; dish: string; userId: string | null; displayName: string | null; recipeId:string|null; recipeTitle:string|null; rating: string; feedback: string; nextTimeChanges: string | null; repeatDecision: string | null };
export type FoodPreferenceRecord={id:string;userId:string|null;displayName:string|null;topic:string;classification:string;detail:string;context:string|null;status:string;effectiveDate:string;createdAt:string};
export type ImportBatchRecord = { id: string; sourceFilename: string; status: string; sourceRows: number; acceptedRows: number; warningRows: number; rejectedRows: number; reconciliationRows:number; resolvedRows:number; createdAt: string; committedAt:string|null };
export type AiProposalRecord={id:string;workflow:string;status:string;payload:{title:string;summary:string;warnings:string[];actions:Array<{id:string;type:string;label:string;explanation:string;[key:string]:unknown}>};selectedActionIds:string[];resultPayload:unknown;model:string|null;modelTier:string|null;totalTokens:number|null;estimatedCostUsd:string|null;createdAt:string;expiresAt:string;approvedAt:string|null;rejectedAt:string|null};
export type WeeklyPlanRecord={id:string;status:string;startDate:string;endDate:string;startMeal:string;endMeal:string;discoverRecipes:boolean;originalRequest:string|null;normalizedRequest:string|null;payload:WeeklyPlan;issues:Array<{severity:"error"|"warning";code:string;message:string;mealId:string|null}>;revisionNumber:number;model:string|null;modelTier:string|null;totalTokens:number|null;estimatedCostUsd:string|null;webSearchCalls:number|null;webSourceCount:number|null;createdAt:string;updatedAt:string;committedAt:string|null;revisions:Array<{revisionNumber:number;source:string;summary:string;changeDetail:Record<string,unknown>;createdAt:string}>;recipeSources:Array<{url:string;title:string|null;domain:string;verifiedAt:string}>};
export type WeeklyPlanJobRecord={id:string;status:"queued"|"running"|"completed"|"failed"|"cancelled";stage:string;startDate:string;endDate:string;planningMode:"balanced"|"deep";errorMessage:string|null;planId:string|null;createdAt:string;startedAt:string|null;completedAt:string|null;retryOfJobId:string|null;model:string|null;webSearchEnabled:boolean;webSearchCalls:number|null};
export type RecipeIngredientRecord={item:string;quantity:number|null;unit:string|null;preparation:string|null;optional:boolean;notes:string|null};
export type RecipeRecord={id:string;title:string;sourceType:string;sourceUrl:string|null;description:string|null;cuisine:string|null;mealTypes:string[];plannedYield:string|null;servings:number|null;prepMinutes:number|null;cookMinutes:number|null;ingredients:RecipeIngredientRecord[];instructions:string[];tags:string[];notes:string|null;favorite:boolean;recipeStatus:string;freezerFriendly:boolean;leftoverFriendly:boolean;packedLunchFriendly:boolean;feedbackCount:number;latestFeedback:Array<{person:string|null;rating:string;feedback:string;feedbackDate:string}>;updatedAt:string};
export type FlyerSaleRecord={id:string;item:string;brand:string|null;category:string|null;packageSize:string|null;price:string;regularPrice:string|null;savingsAmount:string|null;discountPercent:string|null;pricingUnit:string|null;multiBuyQuantity:number|null;memberOnly:boolean;limitText:string|null;notes:string|null;confidence:string|null;evidenceText:string|null;sourceReference:string|null;status:string;prioritized:boolean};
export type FlyerRecord={id:string;storeName:string;storeLocation:string|null;validFrom:string;validUntil:string;sourceType:string;sourceUrl:string|null;originalFilename:string|null;mimeType:string|null;hasFile:boolean;status:string;extractionWarnings:string[];createdAt:string;committedAt:string|null;sales:FlyerSaleRecord[]};

export async function listInventory(householdId: string): Promise<InventoryRecord[]> {
  const result = await poolOrThrow().query<InventoryRecord>(`
    SELECT i.id, i.ingredient, i.brand_variety AS "brandVariety", i.category,
           i.quantity::text, i.unit, l.name AS "locationName", i.storage_location_id AS "storageLocationId", COALESCE(i.storage_detail,l.detail) AS "storageDetail",
           i.package_state AS "packageState", i.best_before::text AS "bestBefore", i.priority,
           i.notes, i.updated_at::text AS "updatedAt"
      FROM inventory_entries i LEFT JOIN storage_locations l ON l.id = i.storage_location_id
     WHERE i.household_id = $1 AND i.archived_at IS NULL
     ORDER BY CASE i.priority WHEN 'use_now' THEN 0 WHEN 'use_soon' THEN 1 WHEN 'reserved' THEN 3 ELSE 2 END,
              lower(i.ingredient), l.sort_order, i.storage_detail
  `, [householdId]);
  return result.rows;
}

export async function listGroceryRegistrationInventory(householdId:string):Promise<InventoryRecord[]>{
  const result=await poolOrThrow().query<InventoryRecord>(`
    SELECT i.id,i.ingredient,i.brand_variety AS "brandVariety",i.category,i.quantity::text,i.unit,
           l.name AS "locationName",i.storage_location_id AS "storageLocationId",COALESCE(i.storage_detail,l.detail) AS "storageDetail",
           i.package_state AS "packageState",i.best_before::text AS "bestBefore",i.priority,i.notes,i.updated_at::text AS "updatedAt",i.archived_at::text AS "archivedAt"
      FROM inventory_entries i LEFT JOIN storage_locations l ON l.id=i.storage_location_id
     WHERE i.household_id=$1 AND (i.archived_at IS NULL OR EXISTS (
       SELECT 1 FROM shopping_items s WHERE s.household_id=$1 AND s.status='purchased' AND s.inventory_entry_id=i.id
     ))
     ORDER BY i.archived_at NULLS FIRST,CASE i.priority WHEN 'use_now' THEN 0 WHEN 'use_soon' THEN 1 WHEN 'reserved' THEN 3 ELSE 2 END,lower(i.ingredient)
  `,[householdId]);
  return result.rows;
}

export async function listStorageLocations(householdId: string): Promise<StorageLocationRecord[]> {
  const result = await poolOrThrow().query<StorageLocationRecord>(`
    SELECT id, name, detail FROM storage_locations WHERE household_id = $1 AND active = true ORDER BY sort_order, name, detail NULLS FIRST
  `, [householdId]);
  return result.rows;
}

export async function listHouseholdUsers(householdId: string): Promise<HouseholdUserRecord[]> {
  const result = await poolOrThrow().query<HouseholdUserRecord>(`
    SELECT id, display_name AS "displayName", role FROM household_users WHERE household_id = $1 AND active = true ORDER BY display_name
  `, [householdId]);
  return result.rows;
}

export async function listShopping(householdId: string): Promise<ShoppingRecord[]> {
  const result = await poolOrThrow().query<ShoppingRecord>(`
    SELECT id, item, category, quantity::text, unit, status, notes,
           inventory_entry_id AS "inventoryEntryId"
      FROM shopping_items WHERE household_id = $1 AND status <> 'removed'
     ORDER BY CASE status WHEN 'to_buy' THEN 0 WHEN 'deferred' THEN 1 ELSE 2 END, lower(item)
  `, [householdId]);
  return result.rows;
}

export async function listMeals(householdId: string, from?: string, to?: string): Promise<MealRecord[]> {
  const result = await poolOrThrow().query<MealRecord>(`
    WITH context AS (
      SELECT (now() AT TIME ZONE timezone)::date AS today FROM households WHERE id=$1
    )
    SELECT m.id, m.meal_date::text AS "mealDate", m.meal_type AS "mealType", m.assigned_user_id AS "assignedUserId",
           u.display_name AS "assignedName", m.dish, m.planned_yield AS "plannedYield", m.packed_lunch AS "packedLunch",
           m.status, m.notes
      FROM meal_plan_entries m LEFT JOIN household_users u ON u.id = m.assigned_user_id
     WHERE m.household_id = $1
       AND m.archived_at IS NULL
       AND m.meal_date >= COALESCE($2::date, (SELECT today FROM context) - 7)
       AND m.meal_date <= COALESCE($3::date, (SELECT today FROM context) + 14)
     ORDER BY m.meal_date, CASE m.meal_type WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 WHEN 'dinner' THEN 2 WHEN 'snack' THEN 3 ELSE 4 END, u.display_name
  `, [householdId, from ?? null, to ?? null]);
  return result.rows;
}

export async function listPendingMealInventoryReviews(householdId:string):Promise<MealInventoryReviewRecord[]>{
  const result=await poolOrThrow().query<MealInventoryReviewRecord>(`SELECT id,meal_date::text AS "mealDate",status,suggestions,created_at::text AS "createdAt" FROM meal_day_inventory_reviews WHERE household_id=$1 AND status='pending' ORDER BY meal_date,created_at LIMIT 20`,[householdId]);
  return result.rows;
}

export async function listUnscheduled(householdId: string, from?: string, to?: string): Promise<UnscheduledRecord[]> {
  const result = await poolOrThrow().query<UnscheduledRecord>(`
    WITH context AS (
      SELECT (now() AT TIME ZONE timezone)::date AS today FROM households WHERE id=$1
    )
    SELECT x.id,x.week_start::text AS "weekStart",x.item_type AS "itemType",x.assigned_user_id AS "assignedUserId",
           u.display_name AS "assignedName",x.title,x.planned_yield AS "plannedYield",x.status,x.notes
      FROM unscheduled_items x LEFT JOIN household_users u ON u.id=x.assigned_user_id
     WHERE x.household_id=$1 AND x.week_start >= COALESCE($2::date,(SELECT today FROM context)-14) AND x.week_start <= COALESCE($3::date,(SELECT today FROM context)+14)
     ORDER BY x.week_start,CASE x.item_type WHEN 'prep' THEN 0 WHEN 'dessert' THEN 1 WHEN 'snack' THEN 2 ELSE 3 END,lower(x.title)
  `, [householdId,from??null,to??null]);
  return result.rows;
}

export async function listFeedback(householdId: string): Promise<FeedbackRecord[]> {
  const result = await poolOrThrow().query<FeedbackRecord>(`
    SELECT f.id, f.feedback_date::text AS "feedbackDate", f.dish, f.user_id AS "userId", u.display_name AS "displayName",f.recipe_id AS "recipeId",r.title AS "recipeTitle",
           f.rating, f.feedback, f.next_time_changes AS "nextTimeChanges", f.repeat_decision AS "repeatDecision"
      FROM meal_feedback f LEFT JOIN household_users u ON u.id = f.user_id LEFT JOIN recipes r ON r.id=f.recipe_id
     WHERE f.household_id = $1 ORDER BY f.feedback_date DESC, f.created_at DESC LIMIT 100
  `, [householdId]);
  return result.rows;
}

export async function listFoodPreferences(householdId:string):Promise<FoodPreferenceRecord[]>{const result=await poolOrThrow().query<FoodPreferenceRecord>(`SELECT p.id,p.user_id AS "userId",u.display_name AS "displayName",p.topic,p.classification,p.detail,p.context,p.status,p.effective_date::text AS "effectiveDate",p.created_at::text AS "createdAt" FROM food_preferences p LEFT JOIN household_users u ON u.id=p.user_id WHERE p.household_id=$1 ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'contextual' THEN 1 ELSE 2 END,u.display_name NULLS FIRST,lower(p.topic),p.effective_date DESC`,[householdId]);return result.rows;}

export async function getDashboard(householdId: string) {
  const [metrics, meals, useFirst, shopping] = await Promise.all([
    poolOrThrow().query<{ inventoryCount: number; useNowCount: number; shoppingOpenCount: number }>(`
      SELECT
        (SELECT count(*)::int FROM inventory_entries WHERE household_id=$1 AND archived_at IS NULL) AS "inventoryCount",
        (SELECT count(*)::int FROM inventory_entries WHERE household_id=$1 AND archived_at IS NULL AND priority='use_now') AS "useNowCount",
        (SELECT count(*)::int FROM shopping_items WHERE household_id=$1 AND status='to_buy') AS "shoppingOpenCount"
    `, [householdId]),
    poolOrThrow().query<{ mealType: string; dish: string; assignedName: string | null }>(`
      SELECT m.meal_type AS "mealType", m.dish, u.display_name AS "assignedName"
        FROM meal_plan_entries m LEFT JOIN household_users u ON u.id=m.assigned_user_id
       WHERE m.household_id=$1
         AND m.meal_date=(SELECT (now() AT TIME ZONE timezone)::date FROM households WHERE id=$1)
         AND m.archived_at IS NULL ORDER BY m.meal_type, u.display_name
    `, [householdId]),
    poolOrThrow().query<InventoryRecord>(`
      SELECT i.id, i.ingredient, i.brand_variety AS "brandVariety", i.category, i.quantity::text, i.unit,
             l.name AS "locationName", i.storage_location_id AS "storageLocationId", COALESCE(i.storage_detail,l.detail) AS "storageDetail", i.package_state AS "packageState",
             i.best_before::text AS "bestBefore", i.priority, i.notes, i.updated_at::text AS "updatedAt"
        FROM inventory_entries i LEFT JOIN storage_locations l ON l.id=i.storage_location_id
       WHERE i.household_id=$1 AND i.archived_at IS NULL AND i.priority IN ('use_now','use_soon')
       ORDER BY CASE i.priority WHEN 'use_now' THEN 0 ELSE 1 END, lower(i.ingredient) LIMIT 5
    `, [householdId]),
    poolOrThrow().query<ShoppingRecord>(`
      SELECT id, item, category, quantity::text, unit, status, notes,
             inventory_entry_id AS "inventoryEntryId"
        FROM shopping_items WHERE household_id=$1 AND status='to_buy' ORDER BY created_at LIMIT 6
    `, [householdId]),
  ]);
  return { metrics: metrics.rows[0], meals: meals.rows, useFirst: useFirst.rows, shopping: shopping.rows };
}

export type AuditRecord = { id:string; actor:string|null; source:string; action:string; entityType:string; entityId:string|null; reason:string|null; beforeState:unknown; afterState:unknown; createdAt:string };

export async function listAuditEvents(householdId: string, limit = 10, offset = 0): Promise<AuditRecord[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
  const safeOffset = Math.max(Math.trunc(offset), 0);
  const result = await poolOrThrow().query<AuditRecord>(`
    SELECT a.id, u.display_name AS actor, a.source, a.action, a.entity_type AS "entityType", a.entity_id AS "entityId",
           a.reason, a.before_state AS "beforeState", a.after_state AS "afterState", a.created_at::text AS "createdAt"
      FROM audit_events a LEFT JOIN household_users u ON u.id=a.actor_user_id
     WHERE a.household_id=$1 ORDER BY a.created_at DESC, a.id DESC LIMIT $2 OFFSET $3
  `, [householdId, safeLimit, safeOffset]);
  return result.rows;
}

export async function listImportBatches(householdId: string) {
  const result = await poolOrThrow().query<ImportBatchRecord>(`
    SELECT id, source_filename AS "sourceFilename", status, source_rows AS "sourceRows", accepted_rows AS "acceptedRows",
           warning_rows AS "warningRows", rejected_rows AS "rejectedRows",reconciliation_rows AS "reconciliationRows",resolved_rows AS "resolvedRows",
           created_at::text AS "createdAt",committed_at::text AS "committedAt"
      FROM import_batches WHERE household_id=$1 AND archived_at IS NULL ORDER BY created_at DESC LIMIT 50
  `, [householdId]);
  return result.rows;
}

export async function getHouseholdTimezone(householdId:string):Promise<string> {
  const result=await poolOrThrow().query<{timeZone:string}>(`SELECT timezone AS "timeZone" FROM households WHERE id=$1`,[householdId]);
  if(!result.rows[0]) throw new Error("Household not found");
  return result.rows[0].timeZone;
}

export async function listAiProposals(householdId:string,limit=20):Promise<AiProposalRecord[]>{
  const safeLimit=Math.min(Math.max(Math.trunc(limit),1),50);
  const result=await poolOrThrow().query<AiProposalRecord>(`SELECT p.id,p.workflow,CASE WHEN p.status='pending' AND p.expires_at<=now() THEN 'expired' ELSE p.status::text END AS status,p.payload,p.selected_action_ids AS "selectedActionIds",p.result_payload AS "resultPayload",r.model,r.model_tier AS "modelTier",r.total_tokens AS "totalTokens",r.estimated_cost_usd::text AS "estimatedCostUsd",p.created_at::text AS "createdAt",p.expires_at::text AS "expiresAt",p.approved_at::text AS "approvedAt",p.rejected_at::text AS "rejectedAt" FROM ai_proposals p LEFT JOIN LATERAL (SELECT model,model_tier,total_tokens,estimated_cost_usd FROM ai_runs WHERE job_id=p.job_id ORDER BY created_at DESC LIMIT 1) r ON true WHERE p.household_id=$1 ORDER BY CASE WHEN p.status='pending' AND p.expires_at>now() THEN 0 ELSE 1 END,p.created_at DESC LIMIT $2`,[householdId,safeLimit]);
  return result.rows;
}

export type AiUsageRunRecord={id:string;workflow:string;modelTier:string;model:string;reasoningEffort:string;status:string;inputTokens:number|null;cachedInputTokens:number|null;outputTokens:number|null;totalTokens:number|null;estimatedCostUsd:string|null;latencyMs:number|null;webSearchCalls:number;errorMessage:string|null;createdAt:string;completedAt:string|null};
export type AiUsageSummary={runs:number;failedRuns:number;inputTokens:number;outputTokens:number;totalTokens:number;estimatedCostUsd:string;tiers:Array<{runs:number;failedRuns:number;inputTokens:number;outputTokens:number;totalTokens:number;estimatedCostUsd:string;modelTier:string;model:string}>;recentRuns:AiUsageRunRecord[]};
export async function getAiUsageSummary(householdId:string):Promise<AiUsageSummary>{
  type Summary={runs:number;failedRuns:number;inputTokens:number;outputTokens:number;totalTokens:number;estimatedCostUsd:string};
  type Tier=Summary&{modelTier:string;model:string};
  const [summary,tiers,recentRuns]=await Promise.all([
    poolOrThrow().query<Summary>(`SELECT count(*)::int AS runs,count(*) FILTER (WHERE r.status='failed')::int AS "failedRuns",COALESCE(sum(r.input_tokens),0)::int AS "inputTokens",COALESCE(sum(r.output_tokens),0)::int AS "outputTokens",COALESCE(sum(r.total_tokens),0)::int AS "totalTokens",COALESCE(sum(r.estimated_cost_usd),0)::numeric(12,6)::text AS "estimatedCostUsd" FROM ai_runs r JOIN ai_jobs j ON j.id=r.job_id WHERE j.household_id=$1 AND r.created_at>=now()-interval '30 days'`,[householdId]),
    poolOrThrow().query<Tier>(`SELECT r.model_tier AS "modelTier",r.model,count(*)::int AS runs,count(*) FILTER (WHERE r.status='failed')::int AS "failedRuns",COALESCE(sum(r.input_tokens),0)::int AS "inputTokens",COALESCE(sum(r.output_tokens),0)::int AS "outputTokens",COALESCE(sum(r.total_tokens),0)::int AS "totalTokens",COALESCE(sum(r.estimated_cost_usd),0)::numeric(12,6)::text AS "estimatedCostUsd" FROM ai_runs r JOIN ai_jobs j ON j.id=r.job_id WHERE j.household_id=$1 AND r.created_at>=now()-interval '30 days' GROUP BY r.model_tier,r.model ORDER BY CASE r.model_tier WHEN 'economy' THEN 0 WHEN 'primary' THEN 1 WHEN 'balanced' THEN 2 WHEN 'planning' THEN 3 ELSE 4 END,r.model`,[householdId]),
    poolOrThrow().query<AiUsageRunRecord>(`SELECT r.id,j.workflow,r.model_tier AS "modelTier",r.model,r.reasoning_effort AS "reasoningEffort",r.status,r.input_tokens AS "inputTokens",r.cached_input_tokens AS "cachedInputTokens",r.output_tokens AS "outputTokens",r.total_tokens AS "totalTokens",r.estimated_cost_usd::text AS "estimatedCostUsd",r.latency_ms AS "latencyMs",r.web_search_calls AS "webSearchCalls",r.error_message AS "errorMessage",r.created_at::text AS "createdAt",r.completed_at::text AS "completedAt" FROM ai_runs r JOIN ai_jobs j ON j.id=r.job_id WHERE j.household_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 20`,[householdId]),
  ]);
  return {...summary.rows[0],tiers:tiers.rows,recentRuns:recentRuns.rows};
}

export async function listWeeklyPlans(householdId:string,limit=8):Promise<WeeklyPlanRecord[]>{
  const safeLimit=Math.min(Math.max(Math.trunc(limit),1),20);
  const plans=await poolOrThrow().query<Omit<WeeklyPlanRecord,"revisions"|"recipeSources">>(`SELECT p.id,p.status,p.start_date::text AS "startDate",p.end_date::text AS "endDate",p.start_meal AS "startMeal",p.end_meal AS "endMeal",p.discover_recipes AS "discoverRecipes",p.original_request AS "originalRequest",p.normalized_request AS "normalizedRequest",p.current_payload AS payload,p.validation_issues AS issues,p.revision_number AS "revisionNumber",r.model,r.model_tier AS "modelTier",r.total_tokens AS "totalTokens",r.estimated_cost_usd::text AS "estimatedCostUsd",r.web_search_calls AS "webSearchCalls",r.web_source_count AS "webSourceCount",p.created_at::text AS "createdAt",p.updated_at::text AS "updatedAt",p.committed_at::text AS "committedAt" FROM weekly_plans p LEFT JOIN LATERAL (SELECT model,model_tier,total_tokens,estimated_cost_usd,web_search_calls,web_source_count FROM ai_runs WHERE job_id=p.job_id ORDER BY created_at DESC,id DESC LIMIT 1) r ON true WHERE p.household_id=$1 AND p.archived_at IS NULL ORDER BY CASE p.status WHEN 'draft' THEN 0 WHEN 'committed' THEN 1 ELSE 2 END,p.created_at DESC LIMIT $2`,[householdId,safeLimit]);
  if(!plans.rows.length)return [];
  const [revisions,sources]=await Promise.all([
    poolOrThrow().query<{weeklyPlanId:string;revisionNumber:number;source:string;summary:string;changeDetail:Record<string,unknown>;createdAt:string}>(`SELECT weekly_plan_id AS "weeklyPlanId",revision_number AS "revisionNumber",source,summary,change_detail AS "changeDetail",created_at::text AS "createdAt" FROM weekly_plan_revisions WHERE weekly_plan_id=ANY($1::uuid[]) ORDER BY weekly_plan_id,revision_number DESC`,[plans.rows.map((plan)=>plan.id)]),
    poolOrThrow().query<{weeklyPlanId:string;url:string;title:string|null;domain:string;verifiedAt:string}>(`SELECT weekly_plan_id AS "weeklyPlanId",source_url AS url,source_title AS title,source_domain AS domain,verified_at::text AS "verifiedAt" FROM weekly_plan_recipe_sources WHERE weekly_plan_id=ANY($1::uuid[]) ORDER BY weekly_plan_id,verified_at,id`,[plans.rows.map((plan)=>plan.id)]),
  ]);
  return plans.rows.map((plan)=>({...plan,payload:weeklyPlanSchema.parse(plan.payload),revisions:revisions.rows.filter((revision)=>revision.weeklyPlanId===plan.id).map(({revisionNumber,source,summary,changeDetail,createdAt})=>({revisionNumber,source,summary,changeDetail,createdAt})),recipeSources:sources.rows.filter((source)=>source.weeklyPlanId===plan.id).map(({url,title,domain,verifiedAt})=>({url,title,domain,verifiedAt}))}));
}

export async function listRecipes(householdId:string):Promise<RecipeRecord[]>{const result=await poolOrThrow().query<RecipeRecord>(`SELECT r.id,r.title,r.source_type AS "sourceType",r.source_url AS "sourceUrl",r.description,r.cuisine,r.meal_types AS "mealTypes",r.planned_yield AS "plannedYield",r.servings,r.prep_minutes AS "prepMinutes",r.cook_minutes AS "cookMinutes",r.ingredients,r.instructions,r.tags,r.notes,r.favorite,r.recipe_status AS "recipeStatus",r.freezer_friendly AS "freezerFriendly",r.leftover_friendly AS "leftoverFriendly",r.packed_lunch_friendly AS "packedLunchFriendly",r.updated_at::text AS "updatedAt",(SELECT count(*)::int FROM meal_feedback f WHERE f.recipe_id=r.id) AS "feedbackCount",COALESCE((SELECT jsonb_agg(jsonb_build_object('person',x.person,'rating',x.rating,'feedback',x.feedback,'feedbackDate',x.feedback_date)) FROM (SELECT u.display_name AS person,f.rating,f.feedback,f.feedback_date::text AS feedback_date FROM meal_feedback f LEFT JOIN household_users u ON u.id=f.user_id WHERE f.recipe_id=r.id ORDER BY f.feedback_date DESC,f.created_at DESC LIMIT 3) x),'[]'::jsonb) AS "latestFeedback" FROM recipes r WHERE r.household_id=$1 AND r.archived_at IS NULL ORDER BY r.favorite DESC,CASE r.recipe_status WHEN 'proven' THEN 0 WHEN 'experimental' THEN 1 ELSE 2 END,lower(r.title)`,[householdId]);return result.rows;}

export async function listFlyers(householdId:string):Promise<FlyerRecord[]>{const result=await poolOrThrow().query<Omit<FlyerRecord,"sales">&{sales:FlyerSaleRecord[]}>(`SELECT f.id,f.store_name AS "storeName",f.store_location AS "storeLocation",f.valid_from::text AS "validFrom",f.valid_until::text AS "validUntil",f.source_type AS "sourceType",f.source_url AS "sourceUrl",f.original_filename AS "originalFilename",f.mime_type AS "mimeType",(f.storage_path IS NOT NULL) AS "hasFile",f.status,f.extraction_warnings AS "extractionWarnings",f.created_at::text AS "createdAt",f.committed_at::text AS "committedAt",COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'item',s.item,'brand',s.brand,'category',s.category,'packageSize',s.package_size,'price',s.price::text,'regularPrice',s.regular_price::text,'savingsAmount',s.savings_amount::text,'discountPercent',s.discount_percent::text,'pricingUnit',s.pricing_unit,'multiBuyQuantity',s.multi_buy_quantity,'memberOnly',s.member_only,'limitText',s.limit_text,'notes',s.notes,'confidence',s.confidence::text,'evidenceText',s.evidence_text,'sourceReference',s.source_reference,'status',s.status,'prioritized',s.prioritized) ORDER BY s.prioritized DESC,CASE s.status WHEN 'proposed' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,lower(s.item)) FROM flyer_sale_items s WHERE s.flyer_source_id=f.id),'[]'::jsonb) AS sales FROM flyer_sources f WHERE f.household_id=$1 AND f.archived_at IS NULL ORDER BY CASE f.status WHEN 'review' THEN 0 ELSE 1 END,f.valid_until DESC,f.created_at DESC`,[householdId]);return result.rows;}

export async function listWeeklyPlanJobs(householdId:string,limit=5):Promise<WeeklyPlanJobRecord[]>{
  const safeLimit=Math.min(Math.max(Math.trunc(limit),1),10);
  const result=await poolOrThrow().query<WeeklyPlanJobRecord>(`
    SELECT j.id,j.status,j.input_snapshot->>'stage' AS stage,
           j.input_snapshot#>>'{request,startDate}' AS "startDate",j.input_snapshot#>>'{request,endDate}' AS "endDate",
           COALESCE(j.input_snapshot#>>'{request,planningMode}','balanced') AS "planningMode",
           j.error_message AS "errorMessage",p.id AS "planId",j.created_at::text AS "createdAt",j.started_at::text AS "startedAt",j.completed_at::text AS "completedAt",j.retry_of_job_id AS "retryOfJobId",
           r.model,(j.input_snapshot#>>'{request,discoverRecipes}')::boolean AS "webSearchEnabled",r.web_search_calls AS "webSearchCalls"
      FROM ai_jobs j LEFT JOIN weekly_plans p ON p.job_id=j.id
      LEFT JOIN LATERAL (SELECT model,web_search_calls FROM ai_runs WHERE job_id=j.id ORDER BY created_at DESC,id DESC LIMIT 1) r ON true
     WHERE j.household_id=$1 AND j.workflow='weekly_planning'
       AND j.input_snapshot->>'jobKind'='weekly_plan_generation'
       AND j.input_snapshot->>'dismissedAt' IS NULL
       AND p.archived_at IS NULL
       AND (j.status IN ('queued','running') OR j.created_at>=now()-interval '7 days')
     ORDER BY CASE j.status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,j.created_at DESC
     LIMIT $2
  `,[householdId,safeLimit]);
  return result.rows;
}

export type ImportReconciliationRow = {
  id:string; sourceSheet:string; sourceRow:number; status:string; rawPayload:Record<string,unknown>;
  normalizedPayload:Record<string,unknown>|null; messages:string[]; destinationType:string|null; suggestedAction:string|null;
  duplicateCandidates:Array<{id:string|null;label:string;kind:string;synthetic:boolean}>; resolutionAction:string|null;
  resolutionPayload:Record<string,unknown>|null; resolutionTargetId:string|null; resolvedAt:string|null;
};

export async function getImportBatchDetail(householdId:string,batchId:string) {
  const [batch,rows]=await Promise.all([
    poolOrThrow().query<{id:string;sourceFilename:string;sourceChecksum:string;status:string;sourceRows:number;acceptedRows:number;warningRows:number;rejectedRows:number;reconciliationRows:number;resolvedRows:number;createdAt:string;committedAt:string|null}>(`
      SELECT id,source_filename AS "sourceFilename",source_checksum AS "sourceChecksum",status,source_rows AS "sourceRows",accepted_rows AS "acceptedRows",
             warning_rows AS "warningRows",rejected_rows AS "rejectedRows",reconciliation_rows AS "reconciliationRows",resolved_rows AS "resolvedRows",
             created_at::text AS "createdAt",committed_at::text AS "committedAt"
        FROM import_batches WHERE id=$1 AND household_id=$2`,[batchId,householdId]),
    poolOrThrow().query<ImportReconciliationRow>(`
      SELECT r.id,r.source_sheet AS "sourceSheet",r.source_row AS "sourceRow",r.status,r.raw_payload AS "rawPayload",r.normalized_payload AS "normalizedPayload",
             r.messages,r.destination_type AS "destinationType",r.suggested_action AS "suggestedAction",r.duplicate_candidates AS "duplicateCandidates",
             r.resolution_action AS "resolutionAction",r.resolution_payload AS "resolutionPayload",r.resolution_target_id AS "resolutionTargetId",r.resolved_at::text AS "resolvedAt"
        FROM import_rows r JOIN import_batches b ON b.id=r.batch_id
       WHERE r.batch_id=$1 AND b.household_id=$2 AND r.requires_reconciliation=true
       ORDER BY CASE WHEN r.resolved_at IS NULL THEN 0 ELSE 1 END,r.source_sheet,r.source_row`,[batchId,householdId]),
  ]);
  if(!batch.rows[0]) throw new Error("Record not found");
  return {batch:batch.rows[0],rows:rows.rows};
}
