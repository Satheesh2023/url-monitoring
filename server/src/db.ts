import mysql from "mysql2/promise";
import { randomUUID } from "crypto";

const globalForPool = globalThis as unknown as { mysqlPool: mysql.Pool | undefined };

/**
 * Append pool sizing when absent (same idea as former Prisma URL params).
 */
function mysqlUrlWithPoolDefaults(url: string): string {
  if (/[?&]connectionLimit=/.test(url) || /[?&]connection_limit=/.test(url)) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}connectionLimit=20`;
}

function parseMysqlUrl(urlStr: string): mysql.PoolOptions {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    throw new Error("Invalid DATABASE_URL");
  }
  if (u.protocol !== "mysql:") throw new Error("DATABASE_URL must use mysql:// scheme");
  const database = u.pathname.replace(/^\//, "").split("/")[0];
  if (!database) throw new Error("DATABASE_URL missing database name");

  const connectionLimitRaw =
    u.searchParams.get("connectionLimit") ?? u.searchParams.get("connection_limit");
  const connectionLimit = connectionLimitRaw ? parseInt(connectionLimitRaw, 10) : 20;

  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database,
    connectionLimit: Number.isFinite(connectionLimit) && connectionLimit > 0 ? connectionLimit : 20,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
  };
}

function createPool(): mysql.Pool {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required");
  const cfg = parseMysqlUrl(mysqlUrlWithPoolDefaults(raw));
  return mysql.createPool(cfg);
}

export const pool = globalForPool.mysqlPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForPool.mysqlPool = pool;

export function newRowId(): string {
  return randomUUID().replace(/-/g, "");
}

/** Single connection for migrate script (multipleStatements). */
export async function createMigrationsConnection(): Promise<mysql.Connection> {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required");
  const cfg = parseMysqlUrl(mysqlUrlWithPoolDefaults(raw));
  return mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    multipleStatements: true,
  });
}
