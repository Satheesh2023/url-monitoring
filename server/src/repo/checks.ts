import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool, newRowId } from "../db.js";
import type { Check, LatestCheckRow } from "../types.js";
import type { CheckIncidentSlice, CheckStatsSlice } from "../stats.js";
function mapCheckRow(r: RowDataPacket): Check {
  return {
    id: r.id,
    targetId: r.target_id,
    checkedAt: r.checked_at,
    ok: Boolean(r.ok),
    httpStatus: r.http_status != null ? Number(r.http_status) : null,
    responseTimeMs: r.response_time_ms != null ? Number(r.response_time_ms) : null,
    errorMessage: r.error_message,
    bodySnippet: r.body_snippet,
  };
}

function mapLatestRow(r: RowDataPacket): LatestCheckRow {
  return {
    id: r.id,
    targetId: r.target_id,
    checkedAt: r.checked_at,
    ok: Boolean(r.ok),
    httpStatus: r.http_status != null ? Number(r.http_status) : null,
    responseTimeMs: r.response_time_ms != null ? Number(r.response_time_ms) : null,
    errorMessage: r.error_message,
  };
}

function placeholders(n: number): string {
  if (n <= 0) return "";
  return Array(n).fill("?").join(", ");
}

/**
 * Latest row per target: aggregate `MAX(checked_at)` per target (uses `(target_id, checked_at)`),
 * then join back to `checks`. Tie on `checked_at` → keep greatest `id` (ORDER BY id DESC + dedupe).
 * Chunks large `IN (...)` lists for parser / planner friendliness.
 */
const LATEST_AGG_IN_CHUNK = 200;

export async function findLatestCheckPerTarget(targetIds: string[]): Promise<LatestCheckRow[]> {
  if (targetIds.length === 0) return [];
  const uniq = [...new Set(targetIds)];
  const out: LatestCheckRow[] = [];
  for (let i = 0; i < uniq.length; i += LATEST_AGG_IN_CHUNK) {
    const chunk = uniq.slice(i, i + LATEST_AGG_IN_CHUNK);
    const ph = placeholders(chunk.length);
    const sql = `
      SELECT c.id, c.target_id, c.checked_at, c.ok, c.http_status, c.response_time_ms, c.error_message
      FROM checks c
      INNER JOIN (
        SELECT target_id, MAX(checked_at) AS mx
        FROM checks
        WHERE target_id IN (${ph})
        GROUP BY target_id
      ) t ON c.target_id = t.target_id AND c.checked_at = t.mx
      ORDER BY c.target_id ASC, c.id DESC`;
    const [rows] = await pool.execute<RowDataPacket[]>(sql, chunk);
    const seen = new Set<string>();
    for (const r of rows as RowDataPacket[]) {
      const tid = String(r.target_id);
      if (seen.has(tid)) continue;
      seen.add(tid);
      out.push(mapLatestRow(r));
    }
  }
  return out;
}

export async function insertCheck(input: {
  targetId: string;
  checkedAt: Date;
  ok: boolean;
  httpStatus: number | null;
  responseTimeMs: number | null;
  errorMessage: string | null;
  bodySnippet: string | null;
}): Promise<void> {
  const id = newRowId();
  await pool.execute<ResultSetHeader>(
    `INSERT INTO checks (id, target_id, checked_at, ok, http_status, response_time_ms, error_message, body_snippet)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.targetId,
      input.checkedAt,
      input.ok,
      input.httpStatus,
      input.responseTimeMs,
      input.errorMessage,
      input.bodySnippet,
    ]
  );
}

export async function listChecksPage(
  targetId: string,
  offset: number,
  limit: number
): Promise<Check[]> {
  const lim = safeLimitInt(limit, 500);
  const off = safeOffsetInt(offset);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, target_id, checked_at, ok, http_status, response_time_ms, error_message, body_snippet
     FROM checks WHERE target_id = ? ORDER BY checked_at DESC LIMIT ${lim} OFFSET ${off}`,
    [targetId]
  );
  return rows.map(mapCheckRow);
}

export async function countChecksForTarget(targetId: string): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM checks WHERE target_id = ?`,
    [targetId]
  );
  return Number(rows[0]?.c ?? 0);
}

function checkCap(): number {
  const n = parseInt(process.env.STATS_CHECK_CAP ?? "50000", 10);
  return Number.isFinite(n) && n > 1000 ? n : 50_000;
}

/**
 * Aurora MySQL often rejects bound `LIMIT ?` / `OFFSET ?` in prepared statements
 * (`Incorrect arguments to mysqld_stmt_execute`). Inline validated integers instead.
 */
function safeLimitInt(n: number, max = 500_000): number {
  const lim = Math.floor(Number(n));
  if (!Number.isFinite(lim) || lim < 1) return 1;
  return Math.min(lim, max);
}

function safeOffsetInt(n: number, max = 2_000_000_000): number {
  const o = Math.floor(Number(n));
  if (!Number.isFinite(o) || o < 0) return 0;
  return Math.min(o, max);
}

/**
 * Newest `cap` rows in [start,end] — no OFFSET scan (avoids multi-minute queries on large windows).
 */
export async function fetchChecksBudgetedStats(
  targetId: string,
  start: Date,
  end: Date
): Promise<{ rows: CheckStatsSlice[]; totalInWindow: number; truncated: boolean }> {
  const cap = safeLimitInt(checkCap());
  const [[countRows], [dataRows]] = await Promise.all([
    pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM checks
       WHERE target_id = ? AND checked_at >= ? AND checked_at <= ?`,
      [targetId, start, end]
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT checked_at, ok, response_time_ms FROM checks
       WHERE target_id = ? AND checked_at >= ? AND checked_at <= ?
       ORDER BY checked_at DESC
       LIMIT ${cap}`,
      [targetId, start, end]
    ),
  ]);
  const totalInWindow = Number(countRows[0]?.c ?? 0);
  const truncated = totalInWindow > cap;
  const rowsDesc = dataRows as RowDataPacket[];
  const rows: CheckStatsSlice[] = rowsDesc
    .map((r) => ({
      checkedAt: r.checked_at,
      ok: Boolean(r.ok),
      responseTimeMs: r.response_time_ms != null ? Number(r.response_time_ms) : null,
    }))
    .reverse();
  return { rows, totalInWindow, truncated };
}

/** One COUNT + one SELECT for stats, incidents, and latency (same window). */
export type DashboardCheckRow = {
  checkedAt: Date;
  ok: boolean;
  responseTimeMs: number | null;
  errorMessage: string | null;
  httpStatus: number | null;
};

export async function fetchChecksBudgetedDashboard(
  targetId: string,
  start: Date,
  end: Date
): Promise<{ rows: DashboardCheckRow[]; totalInWindow: number; truncated: boolean }> {
  const cap = safeLimitInt(checkCap());
  const [[countRows], [dataRows]] = await Promise.all([
    pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM checks
       WHERE target_id = ? AND checked_at >= ? AND checked_at <= ?`,
      [targetId, start, end]
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT checked_at, ok, response_time_ms, error_message, http_status FROM checks
       WHERE target_id = ? AND checked_at >= ? AND checked_at <= ?
       ORDER BY checked_at DESC
       LIMIT ${cap}`,
      [targetId, start, end]
    ),
  ]);
  const totalInWindow = Number(countRows[0]?.c ?? 0);
  const truncated = totalInWindow > cap;
  const rowsDesc = dataRows as RowDataPacket[];
  const rowsAsc: DashboardCheckRow[] = rowsDesc
    .map((r) => ({
      checkedAt: r.checked_at,
      ok: Boolean(r.ok),
      responseTimeMs: r.response_time_ms != null ? Number(r.response_time_ms) : null,
      errorMessage: r.error_message,
      httpStatus: r.http_status != null ? Number(r.http_status) : null,
    }))
    .reverse();
  return { rows: rowsAsc, totalInWindow, truncated };
}

export async function fetchChecksBudgetedIncidents(
  targetId: string,
  start: Date,
  end: Date
): Promise<{ rows: CheckIncidentSlice[]; totalInWindow: number; truncated: boolean }> {
  const cap = safeLimitInt(checkCap());
  const [[countRows], [dataRows]] = await Promise.all([
    pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM checks
       WHERE target_id = ? AND checked_at >= ? AND checked_at <= ?`,
      [targetId, start, end]
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT checked_at, ok, error_message, http_status FROM checks
       WHERE target_id = ? AND checked_at >= ? AND checked_at <= ?
       ORDER BY checked_at DESC
       LIMIT ${cap}`,
      [targetId, start, end]
    ),
  ]);
  const totalInWindow = Number(countRows[0]?.c ?? 0);
  const truncated = totalInWindow > cap;
  const rowsDesc = dataRows as RowDataPacket[];
  const rows: CheckIncidentSlice[] = rowsDesc
    .map((r) => ({
      checkedAt: r.checked_at,
      ok: Boolean(r.ok),
      errorMessage: r.error_message,
      httpStatus: r.http_status != null ? Number(r.http_status) : null,
    }))
    .reverse();
  return { rows, totalInWindow, truncated };
}
