"use client";

import type { WeeklyPlan } from "@/lib/ai/contracts";

interface WeeklyPlanScorecardProps {
  payload: WeeklyPlan;
}

export function WeeklyPlanScorecard({ payload }: WeeklyPlanScorecardProps) {
  if (payload.planFormatVersion < 2 || !payload.reviewScorecard) {
    return null;
  }

  const { reviewScorecard } = payload;

  return (
    <div className="plan-scorecard">
      <div>
        <strong>{reviewScorecard.saleItemIdsUsed.length}</strong>
        <span>sale opportunities used</span>
        <small>
          {reviewScorecard.qualifiedSalesConsidered} ranked ·{" "}
          {reviewScorecard.prioritySalesConsidered} prioritized
        </small>
      </div>
      <div>
        <strong>
          {reviewScorecard.useNowInventoryIdsUsed.length +
            reviewScorecard.useSoonInventoryIdsUsed.length}
        </strong>
        <span>priority inventory items used</span>
        <small>
          {reviewScorecard.useNowInventoryIdsUsed.length} use now ·{" "}
          {reviewScorecard.useSoonInventoryIdsUsed.length} use soon
        </small>
      </div>
      <div>
        <strong>
          {reviewScorecard.cuisines.length} / {reviewScorecard.techniques.length}
        </strong>
        <span>cuisines / techniques</span>
        <small>{reviewScorecard.primaryIngredients.length} primary ingredients</small>
      </div>
      <div>
        <strong>{reviewScorecard.discoveryMealIds.length}</strong>
        <span>discovery meals</span>
        <small>
          {reviewScorecard.familiarMealIds.length} familiar meals ·{" "}
          {reviewScorecard.recentRepeats.length} recent repeats
        </small>
      </div>
    </div>
  );
}
