import { randomBytes, scryptSync } from "node:crypto";
import pg from "pg";

const displayName = process.argv[2];
const pin = process.env.NEW_PIN;
const householdName = process.env.APP_HOUSEHOLD_NAME || "Kitchen";
if (!displayName || !pin || pin.length < 4)
  throw new Error("A household member and PIN of at least four characters are required.");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
const salt = randomBytes(16);
const hash = `scrypt:${salt.toString("hex")}:${scryptSync(pin, salt, 32).toString("hex")}`;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const result = await client.query(
    `UPDATE household_users u SET pin_hash=$1 FROM households h
    WHERE u.household_id=h.id AND h.name=$2 AND lower(u.display_name)=lower($3) RETURNING u.id,u.household_id,u.display_name`,
    [hash, householdName, displayName],
  );
  if (!result.rowCount) throw new Error(`Household member not found: ${displayName}`);
  const user = result.rows[0];
  await client.query(
    `UPDATE app_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`,
    [user.id],
  );
  await client.query(
    `INSERT INTO audit_events (household_id,source,action,entity_type,entity_id,reason)
    VALUES ($1,'system','reset_pin','household_user',$2,$3)`,
    [user.household_id, user.id, `PIN reset for ${user.display_name}; existing sessions revoked`],
  );
  console.log(`PIN updated for ${user.display_name}.`);
} finally {
  await client.end();
}
