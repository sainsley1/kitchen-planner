import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { appConfig } from "@/lib/config";
import { getPool } from "@/lib/db/client";
import { hashSessionToken, newSessionToken, verifyPin } from "./crypto";

export const SESSION_COOKIE = "kp_session";
const SESSION_DAYS = 30;

export type HouseholdSession = {
  userId: string;
  householdId: string;
  displayName: string;
  role: "owner" | "member";
};

function poolOrThrow() {
  const pool = getPool();
  if (!pool) throw new Error("Database is not configured");
  return pool;
}

export async function listActiveHouseholdUserNames(): Promise<string[]> {
  const result = await poolOrThrow().query<{ displayName: string }>(
    `
    SELECT u.display_name AS "displayName"
      FROM household_users u
      JOIN households h ON h.id = u.household_id
     WHERE h.name = $1 AND u.active = true
     ORDER BY CASE WHEN u.role = 'owner' THEN 0 ELSE 1 END, u.display_name
  `,
    [appConfig.householdName],
  );
  return result.rows.map((user) => user.displayName);
}

export async function authenticateUser(
  displayName: string,
  pin: string,
): Promise<HouseholdSession | null> {
  const result = await poolOrThrow().query<HouseholdSession & { pin_hash: string | null }>(
    `
    SELECT u.id AS "userId", u.household_id AS "householdId", u.display_name AS "displayName",
           u.role, u.pin_hash
      FROM household_users u
      JOIN households h ON h.id = u.household_id
     WHERE lower(u.display_name) = lower($1) AND h.name = $2 AND u.active = true
     LIMIT 1
  `,
    [displayName.trim(), appConfig.householdName],
  );
  const user = result.rows[0];
  if (!user || !verifyPin(pin, user.pin_hash)) return null;
  return {
    userId: user.userId,
    householdId: user.householdId,
    displayName: user.displayName,
    role: user.role,
  };
}

export async function createSession(
  user: HouseholdSession,
): Promise<{ token: string; expiresAt: Date }> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await poolOrThrow().query(
    "INSERT INTO app_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [user.userId, hashSessionToken(token), expiresAt],
  );
  return { token, expiresAt };
}

export async function getCurrentSession(): Promise<HouseholdSession | null> {
  const pool = getPool();
  if (!pool) return null;

  if (appConfig.authMode === "disabled") {
    const fallback = await pool.query<HouseholdSession>(
      `
      SELECT u.id AS "userId", u.household_id AS "householdId", u.display_name AS "displayName", u.role
        FROM household_users u JOIN households h ON h.id = u.household_id
       WHERE h.name = $1 AND u.active = true
       ORDER BY CASE WHEN u.role = 'owner' THEN 0 ELSE 1 END, u.display_name
       LIMIT 1
    `,
      [appConfig.householdName],
    );
    return fallback.rows[0] ?? null;
  }

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const result = await pool.query<HouseholdSession>(
    `
    SELECT u.id AS "userId", u.household_id AS "householdId", u.display_name AS "displayName", u.role
      FROM app_sessions s
      JOIN household_users u ON u.id = s.user_id
      JOIN households h ON h.id = u.household_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
       AND u.active = true AND h.name = $2
     LIMIT 1
  `,
    [hashSessionToken(token), appConfig.householdName],
  );
  return result.rows[0] ?? null;
}

export async function requirePageSession(): Promise<HouseholdSession> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return session;
}

export async function revokeCurrentSession(): Promise<void> {
  const pool = getPool();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (pool && token) {
    await pool.query("UPDATE app_sessions SET revoked_at = now() WHERE token_hash = $1", [
      hashSessionToken(token),
    ]);
  }
}
