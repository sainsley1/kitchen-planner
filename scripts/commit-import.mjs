import pg from "pg";
import { commitImportBatch } from "./lib/import-cutover.mjs";

const [batchId, confirmation] = process.argv.slice(2);
const backupReference = process.env.CUTOVER_BACKUP_REFERENCE;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not configured");
const client = new pg.Client({ connectionString });
await client.connect();
try {
  const result = await commitImportBatch(client, { batchId, confirmation, backupReference });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await client.end();
}
