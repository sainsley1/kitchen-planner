import { z } from "zod";

const optionalSecret = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const configSchema = z.object({
  APP_VERSION: z.string().default("0.6.4.8"),
  DEMO_MODE: z.enum(["true", "false"]).default("true"),
  AUTH_MODE: z.enum(["disabled", "household"]).default("disabled"),
  DATABASE_URL: z.string().optional(),
  APP_HOUSEHOLD_NAME: z.string().default("Kitchen"),
  APP_TIME_ZONE: z
    .string()
    .default("America/Vancouver")
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en-CA", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "APP_TIME_ZONE must be a valid IANA time zone"),
  HOUSEHOLD_SESSION_SECRET: z.string().min(16).default("development-only-secret"),
  OPENAI_API_KEY: optionalSecret,
  OPENAI_ECONOMY_MODEL: z.string().default("gpt-5.4-mini"),
  OPENAI_ROUTINE_MODEL: z.string().default("gpt-5.4"),
  OPENAI_FALLBACK_MODEL: z.string().default("gpt-5.6-terra"),
  OPENAI_RECONCILIATION_MODEL: z.string().default("gpt-5.4"),
  OPENAI_PLANNING_MODEL: z.string().default("gpt-5.6-sol"),
  OPENAI_PLANNING_REASONING_EFFORT: z.enum(["high", "xhigh", "max"]).default("high"),
  OPENAI_PLANNING_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(600_000)
    .max(3_600_000)
    .default(1_800_000),
  OPENAI_ECONOMY_INPUT_USD_PER_M: z.coerce.number().nonnegative().default(0.75),
  OPENAI_ECONOMY_CACHED_INPUT_USD_PER_M: z.coerce.number().nonnegative().default(0.075),
  OPENAI_ECONOMY_OUTPUT_USD_PER_M: z.coerce.number().nonnegative().default(4.5),
  OPENAI_ROUTINE_INPUT_USD_PER_M: z.coerce.number().nonnegative().default(2.5),
  OPENAI_ROUTINE_CACHED_INPUT_USD_PER_M: z.coerce.number().nonnegative().default(0.25),
  OPENAI_ROUTINE_OUTPUT_USD_PER_M: z.coerce.number().nonnegative().default(15),
  OPENAI_FALLBACK_INPUT_USD_PER_M: z.coerce.number().nonnegative().default(2.5),
  OPENAI_FALLBACK_CACHED_INPUT_USD_PER_M: z.coerce.number().nonnegative().default(0.25),
  OPENAI_FALLBACK_OUTPUT_USD_PER_M: z.coerce.number().nonnegative().default(15),
  OPENAI_PLANNING_INPUT_USD_PER_M: z.coerce.number().nonnegative().default(5),
  OPENAI_PLANNING_CACHED_INPUT_USD_PER_M: z.coerce.number().nonnegative().default(0.5),
  OPENAI_PLANNING_OUTPUT_USD_PER_M: z.coerce.number().nonnegative().default(30),
});

const parsed = configSchema.parse({
  APP_VERSION: process.env.APP_VERSION,
  DEMO_MODE: process.env.DEMO_MODE,
  AUTH_MODE: process.env.AUTH_MODE,
  DATABASE_URL: process.env.DATABASE_URL,
  APP_HOUSEHOLD_NAME: process.env.APP_HOUSEHOLD_NAME,
  APP_TIME_ZONE: process.env.APP_TIME_ZONE,
  HOUSEHOLD_SESSION_SECRET: process.env.HOUSEHOLD_SESSION_SECRET,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_ECONOMY_MODEL: process.env.OPENAI_ECONOMY_MODEL,
  OPENAI_ROUTINE_MODEL: process.env.OPENAI_ROUTINE_MODEL,
  OPENAI_FALLBACK_MODEL: process.env.OPENAI_FALLBACK_MODEL,
  OPENAI_RECONCILIATION_MODEL: process.env.OPENAI_RECONCILIATION_MODEL,
  OPENAI_PLANNING_MODEL: process.env.OPENAI_PLANNING_MODEL,
  OPENAI_PLANNING_REASONING_EFFORT: process.env.OPENAI_PLANNING_REASONING_EFFORT,
  OPENAI_PLANNING_TIMEOUT_MS: process.env.OPENAI_PLANNING_TIMEOUT_MS,
  OPENAI_ECONOMY_INPUT_USD_PER_M: process.env.OPENAI_ECONOMY_INPUT_USD_PER_M,
  OPENAI_ECONOMY_CACHED_INPUT_USD_PER_M: process.env.OPENAI_ECONOMY_CACHED_INPUT_USD_PER_M,
  OPENAI_ECONOMY_OUTPUT_USD_PER_M: process.env.OPENAI_ECONOMY_OUTPUT_USD_PER_M,
  OPENAI_ROUTINE_INPUT_USD_PER_M: process.env.OPENAI_ROUTINE_INPUT_USD_PER_M,
  OPENAI_ROUTINE_CACHED_INPUT_USD_PER_M: process.env.OPENAI_ROUTINE_CACHED_INPUT_USD_PER_M,
  OPENAI_ROUTINE_OUTPUT_USD_PER_M: process.env.OPENAI_ROUTINE_OUTPUT_USD_PER_M,
  OPENAI_FALLBACK_INPUT_USD_PER_M: process.env.OPENAI_FALLBACK_INPUT_USD_PER_M,
  OPENAI_FALLBACK_CACHED_INPUT_USD_PER_M: process.env.OPENAI_FALLBACK_CACHED_INPUT_USD_PER_M,
  OPENAI_FALLBACK_OUTPUT_USD_PER_M: process.env.OPENAI_FALLBACK_OUTPUT_USD_PER_M,
  OPENAI_PLANNING_INPUT_USD_PER_M: process.env.OPENAI_PLANNING_INPUT_USD_PER_M,
  OPENAI_PLANNING_CACHED_INPUT_USD_PER_M: process.env.OPENAI_PLANNING_CACHED_INPUT_USD_PER_M,
  OPENAI_PLANNING_OUTPUT_USD_PER_M: process.env.OPENAI_PLANNING_OUTPUT_USD_PER_M,
});

export const appConfig = {
  version: parsed.APP_VERSION,
  demoMode: parsed.DEMO_MODE === "true",
  authMode: parsed.AUTH_MODE,
  databaseUrl: parsed.DATABASE_URL,
  householdName: parsed.APP_HOUSEHOLD_NAME,
  timeZone: parsed.APP_TIME_ZONE,
  sessionSecret: parsed.HOUSEHOLD_SESSION_SECRET,
  aiConfigured: Boolean(parsed.OPENAI_API_KEY),
  openaiApiKey: parsed.OPENAI_API_KEY,
  models: {
    economy: parsed.OPENAI_ECONOMY_MODEL,
    routine: parsed.OPENAI_ROUTINE_MODEL,
    fallback: parsed.OPENAI_FALLBACK_MODEL,
    reconciliation: parsed.OPENAI_RECONCILIATION_MODEL,
    planning: parsed.OPENAI_PLANNING_MODEL,
  },
  planningReasoningEffort: parsed.OPENAI_PLANNING_REASONING_EFFORT,
  planningTimeoutMs: parsed.OPENAI_PLANNING_TIMEOUT_MS,
  economyPricing: {
    inputPerMillion: parsed.OPENAI_ECONOMY_INPUT_USD_PER_M,
    cachedInputPerMillion: parsed.OPENAI_ECONOMY_CACHED_INPUT_USD_PER_M,
    outputPerMillion: parsed.OPENAI_ECONOMY_OUTPUT_USD_PER_M,
  },
  routinePricing: {
    inputPerMillion: parsed.OPENAI_ROUTINE_INPUT_USD_PER_M,
    cachedInputPerMillion: parsed.OPENAI_ROUTINE_CACHED_INPUT_USD_PER_M,
    outputPerMillion: parsed.OPENAI_ROUTINE_OUTPUT_USD_PER_M,
  },
  fallbackPricing: {
    inputPerMillion: parsed.OPENAI_FALLBACK_INPUT_USD_PER_M,
    cachedInputPerMillion: parsed.OPENAI_FALLBACK_CACHED_INPUT_USD_PER_M,
    outputPerMillion: parsed.OPENAI_FALLBACK_OUTPUT_USD_PER_M,
  },
  planningPricing: {
    inputPerMillion: parsed.OPENAI_PLANNING_INPUT_USD_PER_M,
    cachedInputPerMillion: parsed.OPENAI_PLANNING_CACHED_INPUT_USD_PER_M,
    outputPerMillion: parsed.OPENAI_PLANNING_OUTPUT_USD_PER_M,
  },
};
