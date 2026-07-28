import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.log("DATABASE_URL is not configured; skipping migrations.");
  process.exit(0);
}

const client = new Client({ connectionString });
await client.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const migrationDir = path.resolve("drizzle");
  const files = (await fs.readdir(migrationDir)).filter((name) => name.endsWith(".sql")).sort();

  for (const filename of files) {
    const sql = await fs.readFile(path.join(migrationDir, filename), "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    const existing = await client.query(
      "SELECT checksum FROM app_schema_migrations WHERE filename = $1",
      [filename],
    );

    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum) {
        throw new Error(`Migration checksum changed after application: ${filename}`);
      }
      continue;
    }

    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO app_schema_migrations (filename, checksum) VALUES ($1, $2)", [
        filename,
        checksum,
      ]);
      await client.query("COMMIT");
      console.log(`Applied ${filename}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  // The app process owns asynchronous weekly-plan work. If the container was
  // restarted, no previous in-memory worker can still be running. Requeue the
  // durable generation job and close any interrupted run records cleanly.
  await client.query(`
    UPDATE ai_runs
       SET status='failed',error_message=COALESCE(error_message,'Interrupted by an application restart; the weekly plan was safely requeued.'),completed_at=now()
     WHERE status='running'
       AND job_id IN (SELECT id FROM ai_jobs WHERE workflow='weekly_planning')
  `);
  await client.query(`
    UPDATE ai_jobs
       SET status='failed',error_message=COALESCE(error_message,'Interrupted by an application restart.'),completed_at=now()
     WHERE workflow='weekly_planning' AND status='running'
       AND COALESCE(input_snapshot->>'jobKind','')<>'weekly_plan_generation'
  `);
  const recovered = await client.query(`
    UPDATE ai_jobs
       SET status='queued',started_at=NULL,completed_at=NULL,error_message=NULL,
           input_snapshot=jsonb_set(input_snapshot,'{stage}','"queued"'::jsonb,true)
     WHERE workflow='weekly_planning' AND status='running'
       AND input_snapshot->>'jobKind'='weekly_plan_generation'
    RETURNING id
  `);
  if (recovered.rowCount)
    console.log(`Requeued ${recovered.rowCount} interrupted weekly planning job(s).`);
} finally {
  await client.end();
}
