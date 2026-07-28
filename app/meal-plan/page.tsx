import type { Metadata } from "next";
import { MealPlanManager } from "@/components/meal-plan-manager";
import { UnscheduledManager } from "@/components/unscheduled-manager";
import { WeeklyPlanner } from "@/components/weekly-planner";
import { requirePageSession } from "@/lib/auth/session";
import { appConfig } from "@/lib/config";
import {
  getHouseholdTimezone,
  listHouseholdUsers,
  listMeals,
  listPendingMealInventoryReviews,
  listRecipes,
  listUnscheduled,
  listWeeklyPlanJobs,
  listWeeklyPlans,
} from "@/lib/db/queries";
export const metadata: Metadata = { title: "Meal plan" };
export default async function MealPlanPage() {
  const session = await requirePageSession();
  const [items, users, recipes, unscheduled, timeZone, plans, planningJobs, inventoryReviews] =
    await Promise.all([
      listMeals(session.householdId),
      listHouseholdUsers(session.householdId),
      listRecipes(session.householdId),
      listUnscheduled(session.householdId),
      getHouseholdTimezone(session.householdId),
      listWeeklyPlans(session.householdId),
      listWeeklyPlanJobs(session.householdId),
      listPendingMealInventoryReviews(session.householdId),
    ]);
  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Persistent calendar</span>
          <h1>Meal plan</h1>
          <p>
            Generate a reviewed household week, add dated meals, or keep flexible cooking in
            Unscheduled items.
          </p>
        </div>
      </div>
      <WeeklyPlanner
        plans={plans}
        planningJobs={planningJobs}
        users={users}
        recipes={recipes}
        unscheduled={unscheduled}
        timeZone={timeZone}
        aiConfigured={appConfig.aiConfigured}
        balancedModel={appConfig.models.fallback}
        deepModel={appConfig.models.planning}
        deepEffort={appConfig.planningReasoningEffort}
        routineModel={appConfig.models.routine}
        fallbackModel={appConfig.models.fallback}
      />
      <UnscheduledManager items={unscheduled} users={users} timeZone={timeZone} />
      <MealPlanManager
        items={items}
        users={users}
        timeZone={timeZone}
        inventoryReviews={inventoryReviews}
      />
    </div>
  );
}
