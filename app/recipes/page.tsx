import type { Metadata } from "next";
import Link from "next/link";
import { RecipeManager } from "@/components/recipe-manager";
import { requirePageSession } from "@/lib/auth/session";
import { appConfig } from "@/lib/config";
import { getHouseholdTimezone, listHouseholdUsers, listRecipes } from "@/lib/db/queries";
export const metadata: Metadata = { title: "Recipes" };
export default async function RecipesPage() {
  const session = await requirePageSession();
  const [items, users, timeZone] = await Promise.all([
    listRecipes(session.householdId),
    listHouseholdUsers(session.householdId),
    getHouseholdTimezone(session.householdId),
  ]);
  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Household cookbook</span>
          <h1>Recipes</h1>
          <p>
            Store your own methods, trusted links and practical suitability notes so planning can
            use them deliberately.
          </p>
        </div>
        <Link className="secondary-button" href="/flyers">
          Flyers & sales
        </Link>
      </div>
      <RecipeManager
        items={items}
        users={users}
        timeZone={timeZone}
        aiConfigured={appConfig.aiConfigured}
      />
    </div>
  );
}
