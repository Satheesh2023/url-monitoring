import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { isDbDriverError } from "../db-errors.js";
import { fetchChecksBudgetedIncidents, fetchChecksBudgetedStats } from "../check-query.js";
import {
  countChecksForTarget,
  findLatestCheckPerTarget,
  listChecksPage,
} from "../repo/checks.js";
import {
  createTarget,
  deleteTarget,
  findTargetById,
  listTargetsOrderByCreated,
  targetExists,
  updateTarget,
} from "../repo/targets.js";
import type { LatestCheckRow, Target } from "../types.js";
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

type TargetsListResponse = {
  targets: (Target & { latest: LatestCheckRow | null })[];
  partialLatest: boolean;
};

/** Cuts DB QPS when many browsers poll `/api/targets` (set `0` to disable). */
function targetsListCacheTtlMs(): number {
  const n = parseInt(process.env.LIST_TARGETS_CACHE_MS ?? "4000", 10);
  return Number.isFinite(n) && n >= 0 ? n : 4000;
}

let targetsListCache: { expiresAt: number; body: TargetsListResponse } | null = null;
let targetsListInflight: Promise<TargetsListResponse> | null = null;

function invalidateTargetsListCache(): void {
  targetsListCache = null;
}

async function buildTargetsListResponse(): Promise<TargetsListResponse> {
  const targets = await listTargetsOrderByCreated();
  const ids = targets.map((t) => t.id);
  let latest: LatestCheckRow[] = [];
  let latestQueryFailed = false;
  if (ids.length > 0) {
    try {
      latest = await findLatestCheckPerTarget(ids);
    } catch (e) {
      latestQueryFailed = true;
      console.error("[api] /api/targets latest checks query failed", e);
    }
  }
  const byId = new Map<string, LatestCheckRow>(latest.map((c) => [c.targetId, c]));
  return {
    targets: targets.map((t: Target) => ({
      ...t,
      latest: byId.get(t.id) ?? null,
    })),
    partialLatest: latestQueryFailed,
  };
}

async function getTargetsListResponse(): Promise<TargetsListResponse> {
  const ttl = targetsListCacheTtlMs();
  const now = Date.now();
  if (ttl > 0 && targetsListCache && targetsListCache.expiresAt > now) {
    return targetsListCache.body;
  }
  if (targetsListInflight) {
    return targetsListInflight;
  }
  targetsListInflight = (async () => {
    try {
      const body = await buildTargetsListResponse();
      if (ttl > 0) {
        targetsListCache = { expiresAt: Date.now() + ttl, body };
      }
      return body;
    } finally {
      targetsListInflight = null;
    }
  })();
  return targetsListInflight;
}

export function registerApi(app: Express): void {
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/targets", asyncRoute(async (_req, res) => {
    const body = await getTargetsListResponse();
    res.json(body);
  }));

  app.post("/api/targets", asyncRoute(async (req, res) => {
    const parsed = targetCreate.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const t = await createTarget(parsed.data);
    invalidateTargetsListCache();
    res.status(201).json(t);
  }));

  app.get("/api/targets/:id", asyncRoute(async (req, res) => {
    const id = paramId(req);
    const t = await findTargetById(id);
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
    const t = await updateTarget(id, parsed.data);
    if (!t) {
      res.status(404).json({ error: "not found" });
      return;
    }
    invalidateTargetsListCache();
    res.json(t);
  }));

  app.delete("/api/targets/:id", asyncRoute(async (req, res) => {
    const id = paramId(req);
    const ok = await deleteTarget(id);
    if (!ok) {
      res.status(404).json({ error: "not found" });
      return;
    }
    invalidateTargetsListCache();
    res.status(204).send();
  }));

  app.get("/api/targets/:id/checks", asyncRoute(async (req, res) => {
    const targetId = paramId(req);
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));
    const skip = (page - 1) * limit;
    const exists = await targetExists(targetId);
    if (!exists) {
      res.status(404).json({ error: "not found" });
      return;
    }

    const [items, total] = await Promise.all([
      listChecksPage(targetId, skip, limit),
      countChecksForTarget(targetId),
    ]);
    res.json({ items, page, limit, total });
  }));

  app.get("/api/targets/:id/stats", asyncRoute(async (req, res) => {
    const targetId = paramId(req);
    const exists = await findTargetById(targetId);
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
    const existsInc = await targetExists(targetId);
    if (!existsInc) {
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
    const existsLat = await targetExists(targetId);
    if (!existsLat) {
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
    if (isDbDriverError(err)) {
      res.status(503).json({ error: "Database temporarily unavailable" });
      return;
    }
    res.status(503).json({ error: "Service temporarily unavailable" });
  });
}
