import type { RowDataPacket, ResultSetHeader } from "mysql2";

type SqlValue = string | number | boolean | Date | null;
import { pool, newRowId } from "../db.js";
import type { Target } from "../types.js";

function mapTargetRow(r: RowDataPacket): Target {
  return {
    id: r.id,
    url: r.url,
    name: r.name,
    pollIntervalSec: Number(r.poll_interval_sec),
    timeoutMs: Number(r.timeout_ms),
    maxRedirects: Number(r.max_redirects),
    statusMin: Number(r.status_min),
    statusMax: Number(r.status_max),
    keyword: r.keyword,
    enabled: Boolean(r.enabled),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listTargetsOrderByCreated(): Promise<Target[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, url, name, poll_interval_sec, timeout_ms, max_redirects, status_min, status_max,
            keyword, enabled, created_at, updated_at
     FROM targets ORDER BY created_at ASC`
  );
  return rows.map(mapTargetRow);
}

export async function listEnabledTargets(): Promise<Target[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, url, name, poll_interval_sec, timeout_ms, max_redirects, status_min, status_max,
            keyword, enabled, created_at, updated_at
     FROM targets WHERE enabled = TRUE ORDER BY created_at ASC`
  );
  return rows.map(mapTargetRow);
}

export async function findTargetById(id: string): Promise<Target | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, url, name, poll_interval_sec, timeout_ms, max_redirects, status_min, status_max,
            keyword, enabled, created_at, updated_at
     FROM targets WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0] ? mapTargetRow(rows[0]) : null;
}

export type TargetCreateInput = {
  url: string;
  name?: string | null;
  pollIntervalSec?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  statusMin?: number;
  statusMax?: number;
  keyword?: string | null;
  enabled?: boolean;
};

export async function createTarget(data: TargetCreateInput): Promise<Target> {
  const id = newRowId();
  await pool.execute<ResultSetHeader>(
    `INSERT INTO targets (
       id, url, name, poll_interval_sec, timeout_ms, max_redirects, status_min, status_max,
       keyword, enabled, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
    [
      id,
      data.url,
      data.name ?? null,
      data.pollIntervalSec ?? 60,
      data.timeoutMs ?? 10_000,
      data.maxRedirects ?? 5,
      data.statusMin ?? 200,
      data.statusMax ?? 399,
      data.keyword ?? null,
      data.enabled ?? true,
    ]
  );
  const t = await findTargetById(id);
  if (!t) throw new Error("createTarget: row missing after insert");
  return t;
}

export type TargetUpdateInput = Partial<{
  url: string;
  name: string | null;
  pollIntervalSec: number;
  timeoutMs: number;
  maxRedirects: number;
  statusMin: number;
  statusMax: number;
  keyword: string | null;
  enabled: boolean;
}>;

const colMap: Record<keyof TargetUpdateInput, string> = {
  url: "url",
  name: "name",
  pollIntervalSec: "poll_interval_sec",
  timeoutMs: "timeout_ms",
  maxRedirects: "max_redirects",
  statusMin: "status_min",
  statusMax: "status_max",
  keyword: "keyword",
  enabled: "enabled",
};

export async function updateTarget(id: string, data: TargetUpdateInput): Promise<Target | null> {
  const sets: string[] = [];
  const vals: SqlValue[] = [];
  for (const key of Object.keys(data) as (keyof TargetUpdateInput)[]) {
    if (data[key] === undefined) continue;
    sets.push(`${colMap[key]} = ?`);
    vals.push(data[key] as SqlValue);
  }
  if (sets.length === 0) {
    return findTargetById(id);
  }
  sets.push("updated_at = CURRENT_TIMESTAMP(3)");
  vals.push(id);
  const [res] = await pool.execute<ResultSetHeader>(
    `UPDATE targets SET ${sets.join(", ")} WHERE id = ?`,
    vals
  );
  if (res.affectedRows === 0) return null;
  return findTargetById(id);
}

export async function deleteTarget(id: string): Promise<boolean> {
  const [res] = await pool.execute<ResultSetHeader>(`DELETE FROM targets WHERE id = ?`, [id]);
  return res.affectedRows > 0;
}

export async function targetExists(id: string): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 AS x FROM targets WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows.length > 0;
}
