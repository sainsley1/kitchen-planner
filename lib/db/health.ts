import { getPool } from "./client";

export async function databaseHealth(): Promise<"connected" | "not-configured" | "unavailable"> {
  const pool = getPool();
  if (!pool) return "not-configured";
  try {
    await pool.query("select 1 as ok");
    return "connected";
  } catch {
    return "unavailable";
  }
}
