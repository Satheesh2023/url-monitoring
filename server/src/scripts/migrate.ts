import "dotenv/config";
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { RowDataPacket } from "mysql2";
import { createMigrationsConnection } from "../db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const migrationsDir = path.join(__dirname, "..", "..", "sql", "migrations");
  const conn = await createMigrationsConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS _urlmon_migrations (
        name VARCHAR(255) NOT NULL PRIMARY KEY,
        applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const name of files) {
      const [done] = await conn.query<RowDataPacket[]>(
        "SELECT 1 AS x FROM _urlmon_migrations WHERE name = ? LIMIT 1",
        [name]
      );
      if (done.length > 0) continue;

      const full = path.join(migrationsDir, name);
      const sql = readFileSync(full, "utf8");
      await conn.query(sql);
      await conn.query("INSERT INTO _urlmon_migrations (name) VALUES (?)", [name]);
      console.log("[migrate] applied", name);
    }
    console.log("[migrate] done");
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
