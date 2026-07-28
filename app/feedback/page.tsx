import type { Metadata } from "next";
import { FeedbackLearning } from "@/components/feedback-learning";
import { FeedbackManager } from "@/components/feedback-manager";
import { PreferenceManager } from "@/components/preference-manager";
import { requirePageSession } from "@/lib/auth/session";
import { appConfig } from "@/lib/config";
import {
  getHouseholdTimezone,
  listFeedback,
  listFoodPreferences,
  listHouseholdUsers,
  listRecipes,
} from "@/lib/db/queries";
export const metadata: Metadata = { title: "Preferences & feedback" };
export default async function FeedbackPage() {
  const session = await requirePageSession();
  const [items, preferences, users, recipes, timeZone] = await Promise.all([
    listFeedback(session.householdId),
    listFoodPreferences(session.householdId),
    listHouseholdUsers(session.householdId),
    listRecipes(session.householdId),
    getHouseholdTimezone(session.householdId),
  ]);
  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Per person, per dish</span>
          <h1>Feedback & preferences</h1>
          <p>
            Keep every person&apos;s meal-size, workplace, cuisine and recipe rules visible and
            editable.
          </p>
        </div>
      </div>
      <section className="section-card">
        <header>
          <div>
            <h2>Planning preferences</h2>
            <p className="muted">
              These current rules are supplied to weekly planning and targeted refinements.
              Superseded rules remain visible as history.
            </p>
          </div>
        </header>
        <PreferenceManager items={preferences} users={users} timeZone={timeZone} />
      </section>
      <FeedbackLearning aiConfigured={appConfig.aiConfigured} />
      <section className="section-card">
        <header>
          <div>
            <h2>Feedback records</h2>
            <p className="muted">
              Add a record manually, optionally link it to a saved recipe, or review the
              household&apos;s saved feedback.
            </p>
          </div>
        </header>
        <FeedbackManager items={items} users={users} recipes={recipes} timeZone={timeZone} />
      </section>
    </div>
  );
}
