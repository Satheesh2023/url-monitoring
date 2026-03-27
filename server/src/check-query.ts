import { prisma } from "./db.js";
import type { CheckIncidentSlice, CheckStatsSlice } from "./stats.js";

/** Max rows loaded per stats/incidents/latency query (keeps heap bounded). Oldest rows in window are skipped when over cap. */
function checkCap(): number {
  const n = parseInt(process.env.STATS_CHECK_CAP ?? "50000", 10);
  return Number.isFinite(n) && n > 1000 ? n : 50_000;
}

/** Latest row per target for dashboard — omit bodySnippet (large) */
export const selectCheckLatest = {
  id: true,
  targetId: true,
  checkedAt: true,
  ok: true,
  httpStatus: true,
  responseTimeMs: true,
  errorMessage: true,
} as const;

export type LatestCheckRow = {
  id: string;
  targetId: string;
  checkedAt: Date;
  ok: boolean;
  httpStatus: number | null;
  responseTimeMs: number | null;
  errorMessage: string | null;
};

export async function fetchChecksBudgetedStats(
  targetId: string,
  start: Date,
  end: Date
): Promise<{ rows: CheckStatsSlice[]; totalInWindow: number; truncated: boolean }> {
  const where = { targetId, checkedAt: { gte: start, lte: end } };
  const count = await prisma.check.count({ where });
  const cap = checkCap();
  const skip = Math.max(0, count - cap);
  const rows = (await prisma.check.findMany({
    where,
    orderBy: { checkedAt: "asc" },
    skip,
    take: cap,
    select: { checkedAt: true, ok: true, responseTimeMs: true },
  })) as CheckStatsSlice[];
  return { rows, totalInWindow: count, truncated: count > cap };
}

export async function fetchChecksBudgetedIncidents(
  targetId: string,
  start: Date,
  end: Date
): Promise<{ rows: CheckIncidentSlice[]; totalInWindow: number; truncated: boolean }> {
  const where = { targetId, checkedAt: { gte: start, lte: end } };
  const count = await prisma.check.count({ where });
  const cap = checkCap();
  const skip = Math.max(0, count - cap);
  const rows = (await prisma.check.findMany({
    where,
    orderBy: { checkedAt: "asc" },
    skip,
    take: cap,
    select: { checkedAt: true, ok: true, errorMessage: true, httpStatus: true },
  })) as CheckIncidentSlice[];
  return { rows, totalInWindow: count, truncated: count > cap };
}
