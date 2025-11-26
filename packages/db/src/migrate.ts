import { Pool } from "pg";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

// Load env from repo root if available so pnpm db:migrate works without exporting env
const rootEnv = path.resolve(process.cwd(), "../..", ".env.local");
if (fs.existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv });
} else {
  dotenv.config();
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function applied(): Promise<Set<string>> {
  const res = await pool.query<{ name: string }>("SELECT name FROM schema_migrations");
  return new Set(res.rows.map(({ name }) => name));
}

async function applyMigration(file: string, sql: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    await client.query("COMMIT");
    console.log(`Applied ${file}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`Failed to apply ${file}:`, err);
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  await ensureMigrationsTable();
  const already = await applied();

  const migrationsDir = path.join(process.cwd(), "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (already.has(file)) {
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    await applyMigration(file, sql);
  }

  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
