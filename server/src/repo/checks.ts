import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool, newRowId } from "../db.js";
import type { Check, LatestCheckRow } from "../types.js";
import type { CheckIncidentSlice, CheckStatsSlice } from "../stats.js";
import { placeholders } from "./sql-utils.js";

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

/**
 * Latest row per target — ROW_NUMBER avoids Prisma DISTINCT + sort temp files on huge tables.
 * Requires MySQL 8+ / Aurora MySQL 3.x.
 */
export async function findLatestCheckPerTarget(targetIds: string[]): Promise<LatestCheckRow[]> {
  if (targetIds.length === 0) return [];
  const ph = placeholders(targetIds.length);
  const sql = `
    SELECT id, target_id, checked_at, ok, http_status, response_time_ms, error_message
    FROM (
      SELECT id, target_id, checked_at, ok, http_status, response_time_ms, error_message,
        ROW_NUMBER() OVER (PARTITION BY target_id ORDER BY checked_at DESC, id DESC) AS rn
      FROM checks
      WHERE target_id IN (${ph})
    ) sub
    WHERE rn = 1`;
  const [rows] = await pool.execute<RowDataPacket[]>(sql, targetIds);
  return rows.map(mapLatestRow);
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
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, target_id, checked_at, ok, http_status, response_time_ms, error_message, body_snippet
     FROM checks WHERE target_id = ? ORDER BY checked_at DESC LIMIT ? OFFSET ?`,
    [targetId, limit, offset]
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
 * Newest `cap` rows in [start,end] — no OFFSET scan (avoids multi-minute queries on large windows).
 */
export async function fetchChecksBudgetedStats(
  targetId: string,
  start: Date,
  end: Date
): Promise<{ rows: CheckStatsSlice[]; totalInWindow: number; truncated: boolean }> {
  const cap = checkCap();
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
       LIMIT ?`,
      [targetId, start, end, cap]
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

export async function fetchChecksBudgetedIncidents(
  targetId: string,
  start: Date,
  end: Date
): Promise<{ rows: CheckIncidentSlice[]; totalInWindow: number; truncated: boolean }> {
  const cap = checkCap();
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
       LIMIT ?`,
      [targetId, start, end, cap]
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
