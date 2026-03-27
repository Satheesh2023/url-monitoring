import type { Target } from "@prisma/client";
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import {
  fetchChecksBudgetedIncidents,
  fetchChecksBudgetedStats,
  selectCheckLatest,
  type LatestCheckRow,
} from "../check-query.js";
import { prisma } from "../db.js";
import {
  buildIncidentList,
  computeUptimeAndIncidents,
  downsampleLatencySeries,
  percentile,
  windowBounds,
  type WindowKey,
} from "../stats.js";

/** Express 4 does not catch async rejections — without this, DB errors can crash the process. */
function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void | Response | undefined>
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res)).catch(next);
  };
}

function paramId(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? (id[0] ?? "") : (id ?? "");
}

function statusRangeRefine(data: { statusMin?: number; statusMax?: number }, ctx: z.RefinementCtx) {
  const min = data.statusMin ?? 200;
  const max = data.statusMax ?? 399;
  if (min > max) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "statusMin must be <= statusMax",
      path: ["statusMin"],
    });
  }
}

const targetBodySchema = z.object({
  url: z.string().url(),
  name: z.string().max(255).optional().nullable(),
  pollIntervalSec: z.number().int().min(1).max(3600).optional(),
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  maxRedirects: z.number().int().min(0).max(20).optional(),
  statusMin: z.number().int().min(100).max(599).optional(),
  statusMax: z.number().int().min(100).max(599).optional(),
  keyword: z.string().max(500).optional().nullable(),
  enabled: z.boolean().optional(),
});

const targetCreate = targetBodySchema.superRefine(statusRangeRefine);

const targetUpdate = targetBodySchema.partial().superRefine((data, ctx) => {
  if (data.statusMin != null && data.statusMax != null) {
    statusRangeRefine(
      { statusMin: data.statusMin, statusMax: data.statusMax },
      ctx
    );
  }
});

function parseWindow(q: unknown): WindowKey {
  const v = Array.isArray(q) ? q[0] : q;
  if (v === "24h" || v === "7d" || v === "30d") return v;
  return "24h";
}

function isPrismaClientError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = Object.getPrototypeOf(err)?.constructor?.name ?? "";
  return (
    name === "PrismaClientKnownRequestError" ||
    name === "PrismaClientUnknownRequestError" ||
    name === "PrismaClientRustPanicError" ||
    name === "PrismaClientInitializationError"
  );
}

export function registerApi(app: Express): void {
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/targets", asyncRoute(async (_req, res) => {
    const targets = await prisma.target.findMany({ orderBy: { createdAt: "asc" } });
    const ids = targets.map((t) => t.id);
    let latest: LatestCheckRow[] = [];
    if (ids.length > 0) {
      try {
        latest = (await prisma.check.findMany({
          where: { targetId: { in: ids } },
          orderBy: [{ targetId: "asc" }, { checkedAt: "desc" }],
          distinct: ["targetId"],
          select: selectCheckLatest,
        })) as LatestCheckRow[];
      } catch (e) {
        console.error("[api] /api/targets latest checks query failed", e);
      }
    }
    const byId = new Map<string, LatestCheckRow>(latest.map((c) => [c.targetId, c]));
    res.json(
      targets.map((t: Target) => ({
        ...t,
        latest: byId.get(t.id) ?? null,
      }))
    );
  }));

  app.post("/api/targets", asyncRoute(async (req, res) => {
    const parsed = targetCreate.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const t = await prisma.target.create({ data: parsed.data });
    res.status(201).json(t);
  }));

  app.get("/api/targets/:id", asyncRoute(async (req, res) => {
    const id = paramId(req);
    const t = await prisma.target.findUnique({ where: { id } });
    if (!t) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(t);
  }));

  app.put("/api/targets/:id", asyncRoute(async (req, res) => {
    const id = paramId(req);
    const parsed = targetUpdate.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const t = await prisma.target.update({ where: { id }, data: parsed.data });
      res.json(t);
    } catch {
      res.status(404).json({ error: "not found" });
    }
  }));

  app.delete("/api/targets/:id", asyncRoute(async (req, res) => {
    const id = paramId(req);
    try {
      await prisma.target.delete({ where: { id } });
      res.status(204).send();
    } catch {
      res.status(404).json({ error: "not found" });
    }
  }));

  app.get("/api/targets/:id/checks", asyncRoute(async (req, res) => {
    const targetId = paramId(req);
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));
    const skip = (page - 1) * limit;
    const exists = await prisma.target.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!exists) {
      res.status(404).json({ error: "not found" });
      return;
    }

    const [items, total] = await Promise.all([
      prisma.check.findMany({
        where: { targetId },
        orderBy: { checkedAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.check.count({ where: { targetId } }),
    ]);
    res.json({ items, page, limit, total });
  }));

  app.get("/api/targets/:id/stats", asyncRoute(async (req, res) => {
    const targetId = paramId(req);
    const exists = await prisma.target.findUnique({ where: { id: targetId } });
    if (!exists) {
      res.status(404).json({ error: "not found" });
      return;
    }

    const window = parseWindow(req.query.window);
    const { start, end } = windowBounds(window);
    const { rows: checks, totalInWindow, truncated } = await fetchChecksBudgetedStats(
      targetId,
      start,
      end
    );

    const u = computeUptimeAndIncidents(checks, start, end);
    const sortedLat = [...u.latenciesMs].sort((a, b) => a - b);

    let methodology =
      "Uptime uses time between consecutive checks in-window; period before the first check is excluded (no data). After the last check, state is extended to window end.";
    if (truncated) {
      methodology +=
        " When a window has more checks than STATS_CHECK_CAP, only the newest rows are loaded (approximation).";
    }

    res.json({
      window,
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      uptimePercent: u.uptimePercent,
      coveredMs: u.coveredMs,
      downtimeMs: u.downtimeMs,
      incidentCount: u.incidentCount,
      longestOutageMs: u.longestOutageMs,
      p50Ms: percentile(sortedLat, 50),
      p95Ms: percentile(sortedLat, 95),
      checkCount: totalInWindow,
      checksLoaded: checks.length,
      checksTruncated: truncated,
      methodology,
    });
  }));

  app.get("/api/targets/:id/incidents", asyncRoute(async (req, res) => {
    const targetId = paramId(req);
    const exists = await prisma.target.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!exists) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const window = parseWindow(req.query.window);
    const { start, end } = windowBounds(window);
    const { rows: checks, truncated } = await fetchChecksBudgetedIncidents(targetId, start, end);
    res.json({
      window,
      items: buildIncidentList(checks, start, end),
      checksTruncated: truncated,
    });
  }));

  app.get("/api/targets/:id/latency-series", asyncRoute(async (req, res) => {
    const targetId = paramId(req);
    const exists = await prisma.target.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!exists) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const { start, end } = windowBounds("24h");
    const { rows: checks, truncated } = await fetchChecksBudgetedStats(targetId, start, end);
    const bucketMs = 60_000;
    const series = downsampleLatencySeries(checks, start, end, bucketMs);
    res.json({
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      bucketMinutes: bucketMs / 60_000,
      series,
      checksTruncated: truncated,
    });
  }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[api] error", err instanceof Error ? err.stack || err.message : err);
    if (res.headersSent) return;
    if (isPrismaClientError(err)) {
      res.status(503).json({ error: "Database temporarily unavailable" });
      return;
    }
    res.status(503).json({ error: "Service temporarily unavailable" });
  });
}
