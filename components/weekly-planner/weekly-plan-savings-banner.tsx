"use client";

import type { WeeklyPlan } from "@/lib/ai/contracts";
import { computeWeeklyPlanSavings } from "@/lib/services/weekly-savings";

interface WeeklyPlanSavingsBannerProps {
  payload: WeeklyPlan;
}

export function WeeklyPlanSavingsBanner({ payload }: WeeklyPlanSavingsBannerProps) {
  const savings = computeWeeklyPlanSavings(payload);

  return (
    <div
      style={{
        background:
          "linear-gradient(135deg, rgba(19, 115, 51, 0.08) 0%, rgba(26, 115, 232, 0.05) 100%)",
        border: "1px solid rgba(19, 115, 51, 0.2)",
        borderRadius: "10px",
        padding: "14px 18px",
        margin: "12px 0 16px 0",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "10px",
      }}
    >
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "16px",
            fontWeight: 700,
          }}
        >
          <span>💰 Estimated Weekly Plan Savings:</span>
          <span style={{ color: "#137333", fontSize: "18px" }}>
            ~${savings.totalSavingsUsd.toFixed(2)}
          </span>
        </div>
        <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "var(--ink-soft)" }}>
          Utilizes {savings.stealsCount > 0 ? `${savings.stealsCount} Grade A+ flyer sales ` : ""}
          {savings.stealsCount > 0 && savings.flavorAssetsCount > 0 ? "and " : ""}
          {savings.flavorAssetsCount > 0
            ? `${savings.flavorAssetsCount} pantry flavor assets`
            : ""}{" "}
          to reduce net grocery spend.
        </p>
      </div>
      <div style={{ display: "flex", gap: "6px" }}>
        {savings.stealsCount > 0 && (
          <span
            style={{
              background: "#e6f4ea",
              color: "#137333",
              border: "1px solid #ceead6",
              fontSize: "11px",
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: "12px",
            }}
          >
            🔥 {savings.stealsCount} A+ Steals
          </span>
        )}
        {savings.flavorAssetsCount > 0 && (
          <span
            style={{
              background: "#e8f0fe",
              color: "#1a73e8",
              border: "1px solid #d2e3fc",
              fontSize: "11px",
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: "12px",
            }}
          >
            🌿 {savings.flavorAssetsCount} Flavor Assets
          </span>
        )}
      </div>
    </div>
  );
}
