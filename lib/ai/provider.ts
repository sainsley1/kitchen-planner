import "server-only";
import { createHmac } from "node:crypto";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ResponseInput } from "openai/resources/responses/responses";
import type { ZodType } from "zod";
import { appConfig } from "@/lib/config";

export type AiUsage = {
  responseId: string;
  model: string;
  reasoningEffort: "low" | "medium" | "high" | "xhigh" | "max";
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  webSearchCalls: number;
  webSourceCount: number;
  reasoningTokens?: number;
};
export type AiWebSource = { url: string; title: string | null };
export type AiModelTier = "economy" | "primary" | "balanced" | "fallback" | "planning";

export class AiStructuredResponseError extends Error {
  readonly usage: AiUsage;
  readonly incompleteReason: string | null;
  constructor(message: string, usage: AiUsage, incompleteReason: string | null) {
    super(message);
    this.name = "AiStructuredResponseError";
    this.usage = usage;
    this.incompleteReason = incompleteReason;
  }
}

export function aiUsageFromError(error: unknown) {
  return error instanceof AiStructuredResponseError ? error.usage : undefined;
}

export function isAiMaxOutputTokensError(error: unknown) {
  return (
    error instanceof AiStructuredResponseError && error.incompleteReason === "max_output_tokens"
  );
}

let client: OpenAI | undefined;
function openai() {
  if (!appConfig.openaiApiKey)
    throw new Error(
      "OpenAI is not configured. Add OPENAI_API_KEY to .env and run ./unraid.sh update.",
    );
  client ??= new OpenAI({ apiKey: appConfig.openaiApiKey });
  return client;
}

function safetyIdentifier(householdId: string) {
  return createHmac("sha256", appConfig.sessionSecret)
    .update(`kitchen-planner:${householdId}`)
    .digest("hex");
}

function estimatedCost(input: number, cached: number, output: number, tier: AiModelTier) {
  const pricing =
    tier === "planning"
      ? appConfig.planningPricing
      : tier === "balanced" || tier === "fallback"
        ? appConfig.fallbackPricing
        : tier === "economy"
          ? appConfig.economyPricing
          : appConfig.routinePricing;
  const uncached = Math.max(input - cached, 0);
  return (
    (uncached * pricing.inputPerMillion +
      cached * pricing.cachedInputPerMillion +
      output * pricing.outputPerMillion) /
    1_000_000
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}
function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
export function isAiTimeoutError(error: unknown) {
  const value = record(error);
  const name = textValue(value?.name);
  const message = textValue(value?.message);
  return (
    name === "APIConnectionTimeoutError" ||
    Boolean(message && /(?:request\s+)?timed\s*out|timeout/i.test(message))
  );
}
function webEvidence(output: unknown): { sources: AiWebSource[]; calls: number } {
  const sourceMap = new Map<string, AiWebSource>();
  let calls = 0;
  const add = (urlValue: unknown, titleValue: unknown) => {
    const url = textValue(urlValue);
    if (!url) return;
    const title = textValue(titleValue);
    const previous = sourceMap.get(url);
    sourceMap.set(url, { url, title: title ?? previous?.title ?? null });
  };
  if (!Array.isArray(output)) return { sources: [], calls };
  for (const itemValue of output) {
    const item = record(itemValue);
    if (!item) continue;
    if (item.type === "web_search_call") {
      calls += 1;
      const action = record(item.action);
      if (action) {
        if (Array.isArray(action.sources))
          for (const sourceValue of action.sources) {
            const source = record(sourceValue);
            if (source) add(source.url, source.title);
          }
        add(action.url, action.title);
      }
    }
    if (item.type === "message" && Array.isArray(item.content))
      for (const contentValue of item.content) {
        const content = record(contentValue);
        if (!content || !Array.isArray(content.annotations)) continue;
        for (const annotationValue of content.annotations) {
          const annotation = record(annotationValue);
          if (annotation?.type === "url_citation") add(annotation.url, annotation.title);
        }
      }
  }
  return { sources: [...sourceMap.values()], calls };
}

function structuredResponseFailure(response: {
  id?: string;
  status?: string;
  error?: { message?: string } | null;
  incomplete_details?: { reason?: string } | null;
  output?: unknown;
  usage?: {
    output_tokens?: number;
    output_tokens_details?: { reasoning_tokens?: number } | null;
  } | null;
}) {
  const responseId = response.id ? ` Response ID: ${response.id}.` : "";
  if (response.error?.message)
    return `OpenAI response failed: ${response.error.message}.${responseId}`;
  if (response.status === "incomplete") {
    const reason = response.incomplete_details?.reason ?? "unknown reason";
    const tokens = response.usage?.output_tokens;
    const tokenText =
      typeof tokens === "number" ? ` after ${tokens.toLocaleString("en-CA")} output tokens` : "";
    const reasoningTokens = response.usage?.output_tokens_details?.reasoning_tokens;
    const reasoningText =
      typeof reasoningTokens === "number" && reasoningTokens > 0
        ? ` (${reasoningTokens.toLocaleString("en-CA")} were reasoning tokens)`
        : "";
    return `OpenAI returned an incomplete structured response (${reason})${tokenText}${reasoningText}.${responseId}`;
  }
  if (Array.isArray(response.output))
    for (const itemValue of response.output) {
      const item = record(itemValue);
      if (item?.type !== "message" || !Array.isArray(item.content)) continue;
      for (const contentValue of item.content) {
        const content = record(contentValue);
        const refusal = textValue(content?.refusal);
        if (content?.type === "refusal" && refusal)
          return `OpenAI refused the extraction: ${refusal}.${responseId}`;
      }
    }
  return `OpenAI completed without a usable structured response (status: ${response.status ?? "unknown"}).${responseId}`;
}

export async function runStructured<T>({
  householdId,
  schema,
  schemaName,
  instructions,
  input,
  modelTier = "primary",
  maxOutputTokens = 8_000,
  webSearch = false,
  signal,
  timeoutMs,
}: {
  householdId: string;
  schema: ZodType<T>;
  schemaName: string;
  instructions: string;
  input: string | ResponseInput;
  modelTier?: AiModelTier;
  maxOutputTokens?: number;
  webSearch?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ value: T; usage: AiUsage; sources: AiWebSource[] }> {
  const model =
    modelTier === "planning"
      ? appConfig.models.planning
      : modelTier === "balanced" || modelTier === "fallback"
        ? appConfig.models.fallback
        : modelTier === "economy"
          ? appConfig.models.economy
          : appConfig.models.routine;
  const reasoningEffort =
    modelTier === "planning"
      ? appConfig.planningReasoningEffort
      : modelTier === "balanced" || modelTier === "fallback"
        ? "medium"
        : "low";
  const started = Date.now();
  const timeout =
    timeoutMs ??
    (modelTier === "planning" || modelTier === "balanced"
      ? appConfig.planningTimeoutMs
      : undefined);
  const requestOptions =
    timeout || signal
      ? { ...(timeout ? { timeout } : {}), ...(signal ? { signal } : {}) }
      : undefined;
  const response = await openai().responses.parse(
    {
      model,
      reasoning: { effort: reasoningEffort },
      instructions,
      input,
      text: { format: zodTextFormat(schema, schemaName) },
      max_output_tokens: maxOutputTokens,
      store: false,
      safety_identifier: safetyIdentifier(householdId),
      ...(webSearch
        ? {
            tools: [
              {
                type: "web_search" as const,
                search_context_size: "medium" as const,
                user_location: {
                  type: "approximate" as const,
                  city: "Victoria",
                  region: "British Columbia",
                  country: "CA",
                  timezone: appConfig.timeZone,
                },
              },
            ],
            include: ["web_search_call.action.sources" as const],
          }
        : {}),
    },
    requestOptions,
  );
  const evidence = webEvidence(response.output);
  const inputTokens = response.usage?.input_tokens ?? 0;
  const cachedInputTokens = response.usage?.input_tokens_details?.cached_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  const totalTokens = response.usage?.total_tokens ?? inputTokens + outputTokens;
  const usage: AiUsage = {
    responseId: response.id,
    model,
    reasoningEffort,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd: estimatedCost(inputTokens, cachedInputTokens, outputTokens, modelTier),
    latencyMs: Date.now() - started,
    webSearchCalls: evidence.calls,
    webSourceCount: evidence.sources.length,
    reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens ?? 0,
  };
  if (!response.output_parsed)
    throw new AiStructuredResponseError(
      structuredResponseFailure(response),
      usage,
      response.status === "incomplete" ? (response.incomplete_details?.reason ?? "unknown") : null,
    );
  return { value: response.output_parsed, sources: evidence.sources, usage };
}
