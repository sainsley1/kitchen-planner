import type { Dispatch, SetStateAction } from "react";
import type { WeeklyPlan } from "@/lib/ai/contracts";
import type {
  HouseholdUserRecord,
  InventoryRecord,
  RecipeRecord,
  UnscheduledRecord,
  WeeklyPlanJobRecord,
  WeeklyPlanRecord,
} from "@/lib/db/queries";

export type Meal = WeeklyPlan["meals"][number];
export type CoverageException = WeeklyPlan["coverageExceptions"][number];
export type ShoppingLine = WeeklyPlan["shopping"][number];
export type IngredientRequirement = Meal["ingredientRequirements"][number];
export type ShoppingDecision = WeeklyPlan["shoppingDecisions"][number];

export interface InventorySearchState {
  line: ShoppingLine;
  query: string;
}

export type SetInventorySearchFn = Dispatch<SetStateAction<InventorySearchState | null>>;

export interface WeeklyPlannerProps {
  plans: WeeklyPlanRecord[];
  planningJobs: WeeklyPlanJobRecord[];
  users: HouseholdUserRecord[];
  recipes: RecipeRecord[];
  unscheduled: UnscheduledRecord[];
  inventory: InventoryRecord[];
  timeZone: string;
  aiConfigured: boolean;
  balancedModel: string;
  deepModel: string;
  deepEffort: string;
  routineModel: string;
  fallbackModel: string;
}
