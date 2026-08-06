import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { appConfig } from "@/lib/config";
import * as schema from "./schema";

let pool: Pool | undefined;

export function getPool(): Pool | undefined {
  if (!appConfig.databaseUrl) return undefined;
  pool ??= new Pool({
    connectionString: appConfig.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    options: `-c timezone=${appConfig.timeZone}`,
  });
  return pool;
}

export function getDatabase() {
  const activePool = getPool();
  return activePool ? drizzle(activePool, { schema }) : undefined;
}

export function poolOrThrow(): Pool {
  const value = getPool();
  if (!value) throw new Error("Database is not configured");
  return value;
}
