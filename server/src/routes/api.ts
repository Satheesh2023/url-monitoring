import type { Check, Target } from "@prisma/client";
import type { Express } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import {
  buildIncidentList,
  computeUptimeAndIncidents,
  downsampleLatencySeries,
  percentile,
  windowBounds,
  type WindowKey,
} from "../stats.js";

const targetCreate = z.object({
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

const targetUpdate = targetCreate.partial();

function parseWindow(q: unknown): WindowKey {
  if (q === "24h" || q === "7d" || q === "30d") return q;
  return "24h";
}

export function registerApi(app: Express): void {
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/targets", async (_req, res) => {
    const targets = await prisma.target.findMany({ orderBy: { createdAt: "asc" } });
    const ids = targets.map((t) => t.id);
    const latest = await prisma.check.findMany({
      where: { targetId: { in: ids } },
      orderBy: { checkedAt: "desc" },
      distinct: ["targetId"],
    });
    const byId = new Map<string, Check>(latest.map((c: Check) => [c.targetId, c]));
    res.json(
      targets.map((t: Target) => ({
        ...t,
        latest: byId.get(t.id) ?? null,
      }))
    );
  });

  app.post("/api/targets", async (req, res) => {
    const parsed = targetCreate.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const t = await prisma.target.create({ data: parsed.data });
    res.status(201).json(t);
  });

  app.get("/api/targets/:id", async (req, res) => {
    const t = await prisma.target.findUnique({ where: { id: req.params.id } });
    if (!t) return res.status(404).json({ error: "not found" });
    res.json(t);
  });

  app.put("/api/targets/:id", async (req, res) => {
    const parsed = targetUpdate.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const t = await prisma.target.update({ where: { id: req.params.id }, data: parsed.data });
      res.json(t);
    } catch {
      res.status(404).json({ error: "not found" });
    }
  });

  app.delete("/api/targets/:id", async (req, res) => {
    try {
      await prisma.target.delete({ where: { id: req.params.id } });
      res.status(204).send();
    } catch {
      res.status(404).json({ error: "not found" });
    }
  });

  app.get("/api/targets/:id/checks", async (req, res) => {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));
    const skip = (page - 1) * limit;
    const targetId = req.params.id;
    const exists = await prisma.target.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!exists) return res.status(404).json({ error: "not found" });

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
  });

  app.get("/api/targets/:id/stats", async (req, res) => {
    const targetId = req.params.id;
    const exists = await prisma.target.findUnique({ where: { id: targetId } });
    if (!exists) return res.status(404).json({ error: "not found" });

    const window = parseWindow(req.query.window);
    const { start, end } = windowBounds(window);
    const checks = await prisma.check.findMany({
      where: { targetId, checkedAt: { gte: start, lte: end } },
      orderBy: { checkedAt: "asc" },
    });

    const u = computeUptimeAndIncidents(checks, start, end);
    const sortedLat = [...u.latenciesMs].sort((a, b) => a - b);

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
      checkCount: checks.length,
      methodology:
        "Uptime uses time between consecutive checks in-window; period before the first check is excluded (no data). After the last check, state is extended to window end.",
    });
  });

  app.get("/api/targets/:id/incidents", async (req, res) => {
    const targetId = req.params.id;
    const exists = await prisma.target.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!exists) return res.status(404).json({ error: "not found" });
    const window = parseWindow(req.query.window);
    const { start, end } = windowBounds(window);
    const checks = await prisma.check.findMany({
      where: { targetId, checkedAt: { gte: start, lte: end } },
      orderBy: { checkedAt: "asc" },
    });
    res.json({
      window,
      items: buildIncidentList(checks, start, end),
    });
  });

  app.get("/api/targets/:id/latency-series", async (req, res) => {
    const targetId = req.params.id;
    const exists = await prisma.target.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!exists) return res.status(404).json({ error: "not found" });
    const { start, end } = windowBounds("24h");
    const checks = await prisma.check.findMany({
      where: { targetId, checkedAt: { gte: start, lte: end } },
      orderBy: { checkedAt: "asc" },
    });
    const bucketMs = 60_000;
    const series = downsampleLatencySeries(checks, start, end, bucketMs);
    res.json({
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      bucketMinutes: bucketMs / 60_000,
      series,
    });
  });
}
