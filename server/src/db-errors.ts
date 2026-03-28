/**
 * mysql2 query/connection errors expose `sqlMessage`, `sqlState`, `errno`, and `code` (e.g. ER_*).
 * Do not treat arbitrary `{ code: string }` as DB errors — that mislabels timeouts/network issues
 * as "Database temporarily unavailable" and confuses the UI.
 */
export function isDbDriverError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const o = err as Record<string, unknown>;
  const code = o.code;
  if (typeof code === "string" && code.startsWith("ER_")) return true;
  if (typeof o.sqlState === "string" && o.sqlState.length > 0) return true;
  if (typeof o.sqlMessage === "string" && typeof o.errno === "number") return true;
  return false;
}
