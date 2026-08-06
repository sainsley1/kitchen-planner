import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock("@/lib/db/client", () => ({ getPool: () => state.pool, poolOrThrow: () => state.pool }));

import { getAiUsageSummary } from "../lib/db/queries";

describe("AI usage reporting", () => {
  beforeEach(() => {
    state.pool = null;
  });

  it("returns 30-day tier totals and exact recent-run token details", async () => {
    const database = new PGlite();
    for (const name of (await fs.readdir("drizzle"))
      .filter((entry) => /^\d{4}.*\.sql$/.test(entry))
      .sort())
      await database.exec(await fs.readFile(`drizzle/${name}`, "utf8"));
    const client = {
      query: (text: string, values?: unknown[]) => database.query(text, values),
      release: () => undefined,
    };
    state.pool = { connect: async () => client, query: client.query };
    const household = (
      await database.query<{ id: string }>(
        "INSERT INTO households (name) VALUES ('Kitchen') RETURNING id",
      )
    ).rows[0];
    const user = (
      await database.query<{ id: string }>(
        "INSERT INTO household_users (household_id,display_name,role) VALUES ($1,'Alex','owner') RETURNING id",
        [household.id],
      )
    ).rows[0];
    const balancedJob = (
      await database.query<{ id: string }>(
        "INSERT INTO ai_jobs (household_id,actor_user_id,workflow,status,completed_at) VALUES ($1,$2,'weekly_planning','completed',now()) RETURNING id",
        [household.id, user.id],
      )
    ).rows[0];
    const routineJob = (
      await database.query<{ id: string }>(
        "INSERT INTO ai_jobs (household_id,actor_user_id,workflow,status,error_message,completed_at) VALUES ($1,$2,'quick_update','failed','Bad response',now()) RETURNING id",
        [household.id, user.id],
      )
    ).rows[0];
    await database.query(
      `INSERT INTO ai_runs (job_id,model,reasoning_effort,prompt_version,status,model_tier,input_tokens,cached_input_tokens,output_tokens,total_tokens,estimated_cost_usd,latency_ms,web_search_calls,created_at,completed_at)
      VALUES ($1,'gpt-5.6-terra','medium','weekly-plan-v5','completed','balanced',1000,250,500,1500,0.009375,12500,2,now()-interval '1 minute',now()),
             ($2,'gpt-5.4','low','quick-v1','failed','primary',200,0,20,220,0.0008,900,0,now(),now())`,
      [balancedJob.id, routineJob.id],
    );

    const usage = await getAiUsageSummary(household.id);
    expect(usage).toMatchObject({
      runs: 2,
      failedRuns: 1,
      inputTokens: 1200,
      outputTokens: 520,
      totalTokens: 1720,
      estimatedCostUsd: "0.010175",
    });
    expect(usage.tiers).toEqual([
      expect.objectContaining({
        modelTier: "primary",
        model: "gpt-5.4",
        runs: 1,
        failedRuns: 1,
        totalTokens: 220,
      }),
      expect.objectContaining({
        modelTier: "balanced",
        model: "gpt-5.6-terra",
        runs: 1,
        failedRuns: 0,
        totalTokens: 1500,
      }),
    ]);
    expect(usage.recentRuns).toEqual([
      expect.objectContaining({
        workflow: "quick_update",
        modelTier: "primary",
        inputTokens: 200,
        cachedInputTokens: 0,
        outputTokens: 20,
        totalTokens: 220,
        status: "failed",
      }),
      expect.objectContaining({
        workflow: "weekly_planning",
        modelTier: "balanced",
        inputTokens: 1000,
        cachedInputTokens: 250,
        outputTokens: 500,
        totalTokens: 1500,
        latencyMs: 12500,
        webSearchCalls: 2,
      }),
    ]);
    await database.close();
  }, 30_000);
});
