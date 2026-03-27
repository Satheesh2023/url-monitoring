import type { Prisma } from "@prisma/client";
import { prisma } from "./db.js";

/** Max rows loaded per stats/incidents/latency query (keeps heap bounded). Oldest rows in window are skipped when over cap. */
function checkCap(): number {
  const n = parseInt(process.env.STATS_CHECK_CAP ?? "50000", 10);
  return Number.isFinite(n) && n > 1000 ? n : 50_000;
}

/** Minimal columns for uptime / latency math */
export const selectCheckStats: Prisma.CheckSelect = {
  checkedAt: true,
  ok: true,
  responseTimeMs: true,
};

/** Minimal columns for incident text */
export const selectCheckIncidents: Prisma.CheckSelect = {
  checkedAt: true,
  ok: true,
  errorMessage: true,
  httpStatus: true,
};

/** Latest row per target for dashboard — omit bodySnippet (large) */
export const selectCheckLatest: Prisma.CheckSelect = {
  id: true,
  targetId: true,
  checkedAt: true,
  ok: true,
  httpStatus: true,
  responseTimeMs: true,
  errorMessage: true,
};

export async function fetchChecksBudgeted<S extends Prisma.CheckSelect>(
  targetId: string,
  start: Date,
  end: Date,
  select: S
): Promise<{
  rows: Prisma.CheckGetPayload<{ select: S }>[];
  totalInWindow: number;
  truncated: boolean;
}> {
  const where = { targetId, checkedAt: { gte: start, lte: end } };
  const count = await prisma.check.count({ where });
  const cap = checkCap();
  const skip = Math.max(0, count - cap);
  const rows = await prisma.check.findMany({
    where,
    orderBy: { checkedAt: "asc" },
    skip,
    take: cap,
    select,
  });
  return { rows, totalInWindow: count, truncated: count > cap };
}
