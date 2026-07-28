import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const state = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("openai", () => ({
  default: class MockOpenAI {
    responses = { parse: state.parse };
  },
}));
vi.mock("openai/helpers/zod", () => ({ zodTextFormat: () => ({ type: "json_schema" }) }));
vi.mock("@/lib/config", () => ({
  appConfig: {
    openaiApiKey: "test-key",
    sessionSecret: "test-session-secret",
    planningReasoningEffort: "high",
    planningTimeoutMs: 1_800_000,
    timeZone: "America/Vancouver",
    models: {
      economy: "gpt-5.4-mini",
      routine: "gpt-5.4",
      fallback: "gpt-5.6-terra",
      planning: "gpt-5.6-sol",
    },
    economyPricing: { inputPerMillion: 0, cachedInputPerMillion: 0, outputPerMillion: 0 },
    routinePricing: { inputPerMillion: 0, cachedInputPerMillion: 0, outputPerMillion: 0 },
    fallbackPricing: { inputPerMillion: 0, cachedInputPerMillion: 0, outputPerMillion: 0 },
    planningPricing: { inputPerMillion: 0, cachedInputPerMillion: 0, outputPerMillion: 0 },
  },
}));

import {
  aiUsageFromError,
  isAiMaxOutputTokensError,
  isAiTimeoutError,
  runStructured,
} from "../lib/ai/provider";

describe("AI provider request timeouts", () => {
  beforeEach(() => {
    state.parse.mockReset();
    state.parse.mockResolvedValue({
      id: "response-1",
      output_parsed: { ok: true },
      output: [
        {
          type: "web_search_call",
          action: {
            type: "search",
            sources: [{ type: "url", url: "https://example.com/recipe", title: "Recipe" }],
          },
        },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "",
              annotations: [
                { type: "url_citation", url: "https://example.com/recipe", title: "Recipe" },
              ],
            },
          ],
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
        input_tokens_details: { cached_tokens: 0 },
      },
    });
  });

  it("uses the extended timeout and configured high effort for deep weekly planning", async () => {
    const schema = z.object({ ok: z.boolean() });
    const planning = await runStructured({
      householdId: "household",
      schema,
      schemaName: "planning",
      instructions: "Plan",
      input: "{}",
      modelTier: "planning",
      webSearch: true,
    });
    await runStructured({
      householdId: "household",
      schema,
      schemaName: "economy",
      instructions: "Normalize",
      input: "{}",
      modelTier: "economy",
    });
    expect(state.parse.mock.calls[0][1]).toEqual({ timeout: 1_800_000 });
    expect(state.parse.mock.calls[1][1]).toBeUndefined();
    expect(state.parse.mock.calls[0][0]).toMatchObject({
      model: "gpt-5.6-sol",
      reasoning: { effort: "high" },
    });
    expect(state.parse.mock.calls[0][0]).toMatchObject({
      tools: [{ type: "web_search", search_context_size: "medium" }],
      include: ["web_search_call.action.sources"],
    });
    expect(state.parse.mock.calls[1][0].tools).toBeUndefined();
    expect(planning.sources).toEqual([{ url: "https://example.com/recipe", title: "Recipe" }]);
    expect(planning.usage).toMatchObject({ webSearchCalls: 1, webSourceCount: 1 });
  });

  it("routes balanced weekly planning to Terra at medium effort with the extended timeout", async () => {
    await runStructured({
      householdId: "household",
      schema: z.object({ ok: z.boolean() }),
      schemaName: "balanced",
      instructions: "Plan",
      input: "{}",
      modelTier: "balanced",
    });
    expect(state.parse.mock.calls[0][1]).toEqual({ timeout: 1_800_000 });
    expect(state.parse.mock.calls[0][0]).toMatchObject({
      model: "gpt-5.6-terra",
      reasoning: { effort: "medium" },
    });
  });

  it("allows a planning fallback to use the extended timeout", async () => {
    await runStructured({
      householdId: "household",
      schema: z.object({ ok: z.boolean() }),
      schemaName: "fallback",
      instructions: "Plan",
      input: "{}",
      modelTier: "fallback",
      timeoutMs: 1_800_000,
    });
    expect(state.parse.mock.calls[0][1]).toEqual({ timeout: 1_800_000 });
  });

  it("recognizes SDK and message-based timeout errors", () => {
    const sdkError = new Error("Request timed out.");
    sdkError.name = "APIConnectionTimeoutError";
    expect(isAiTimeoutError(sdkError)).toBe(true);
    expect(isAiTimeoutError(new Error("Connection timeout while generating"))).toBe(true);
    expect(isAiTimeoutError(new Error("Bad request"))).toBe(false);
  });

  it("reports why an incomplete structured response could not be parsed", async () => {
    state.parse.mockResolvedValueOnce({
      id: "response-incomplete",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output_parsed: null,
      output: [],
      error: null,
      usage: {
        input_tokens: 50_000,
        output_tokens: 20_000,
        total_tokens: 70_000,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 8_000 },
      },
    });
    let caught: unknown;
    try {
      await runStructured({
        householdId: "household",
        schema: z.object({ ok: z.boolean() }),
        schemaName: "flyer",
        instructions: "Extract",
        input: "{}",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      "OpenAI returned an incomplete structured response (max_output_tokens) after 20,000 output tokens (8,000 were reasoning tokens). Response ID: response-incomplete.",
    );
    expect(aiUsageFromError(caught)).toMatchObject({
      responseId: "response-incomplete",
      inputTokens: 50_000,
      outputTokens: 20_000,
      totalTokens: 70_000,
      reasoningTokens: 8_000,
    });
    expect(isAiMaxOutputTokensError(caught)).toBe(true);
  });

  it("surfaces a structured-output refusal", async () => {
    state.parse.mockResolvedValueOnce({
      id: "response-refusal",
      status: "completed",
      incomplete_details: null,
      output_parsed: null,
      output: [
        { type: "message", content: [{ type: "refusal", refusal: "I cannot process this file" }] },
      ],
      error: null,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
        input_tokens_details: { cached_tokens: 0 },
      },
    });
    await expect(
      runStructured({
        householdId: "household",
        schema: z.object({ ok: z.boolean() }),
        schemaName: "flyer",
        instructions: "Extract",
        input: "{}",
      }),
    ).rejects.toThrow(
      "OpenAI refused the extraction: I cannot process this file. Response ID: response-refusal.",
    );
  });
});
