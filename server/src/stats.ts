/** Slim rows for RAM — omit id, bodySnippet, targetId where not needed */
export type CheckStatsSlice = {
  checkedAt: Date;
  ok: boolean;
  responseTimeMs: number | null;
};
export type CheckIncidentSlice = {
  checkedAt: Date;
  ok: boolean;
  errorMessage: string | null;
  httpStatus: number | null;
};

export type WindowKey = "24h" | "7d" | "30d";

export function windowBounds(window: WindowKey): { start: Date; end: Date } {
  const end = new Date();
  const ms =
    window === "24h" ? 24 * 3600_000 : window === "7d" ? 7 * 24 * 3600_000 : 30 * 24 * 3600_000;
  return { start: new Date(end.getTime() - ms), end };
}

export function computeUptimeAndIncidents(checks: CheckStatsSlice[], windowStart: Date, windowEnd: Date) {
  if (checks.length === 0) {
    return {
      uptimePercent: null as number | null,
      coveredMs: 0,
      downtimeMs: 0,
      incidentCount: 0,
      longestOutageMs: 0,
      latenciesMs: [] as number[],
    };
  }

  const sorted = [...checks].sort((a, b) => a.checkedAt.getTime() - b.checkedAt.getTime());
  let coveredMs = 0;
  let downtimeMs = 0;
  let incidentCount = 0;
  let longestOutageMs = 0;
  let inIncident = false;
  let currentOutageStart: number | null = null;

  const ws = windowStart.getTime();
  const we = windowEnd.getTime();

  const inWindow = sorted.filter((c) => {
    const t = c.checkedAt.getTime();
    return t >= ws && t <= we;
  });

  const latenciesMs: number[] = [];
  for (const c of inWindow) {
    if (c.ok && c.responseTimeMs != null) latenciesMs.push(c.responseTimeMs);
  }

  if (inWindow.length === 0) {
    return {
      uptimePercent: null,
      coveredMs: 0,
      downtimeMs: 0,
      incidentCount: 0,
      longestOutageMs: 0,
      latenciesMs,
    };
  }

  for (let i = 0; i < inWindow.length; i++) {
    const c = inWindow[i];
    const t0 = c.checkedAt.getTime();
    const t1 = i + 1 < inWindow.length ? inWindow[i + 1].checkedAt.getTime() : we;
    const seg = Math.max(0, t1 - t0);
    if (seg === 0) continue;
    coveredMs += seg;
    if (!c.ok) {
      downtimeMs += seg;
      if (!inIncident) {
        inIncident = true;
        incidentCount += 1;
        currentOutageStart = t0;
      }
    } else {
      if (inIncident && currentOutageStart != null) {
        longestOutageMs = Math.max(longestOutageMs, t0 - currentOutageStart);
      }
      inIncident = false;
      currentOutageStart = null;
    }
  }

  if (inIncident && currentOutageStart != null) {
    longestOutageMs = Math.max(longestOutageMs, we - currentOutageStart);
  }

  const uptimePercent = coveredMs > 0 ? ((coveredMs - downtimeMs) / coveredMs) * 100 : null;

  return {
    uptimePercent,
    coveredMs,
    downtimeMs,
    incidentCount,
    longestOutageMs,
    latenciesMs,
  };
}

export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? null;
}

export function downsampleLatencySeries(
  checks: CheckStatsSlice[],
  windowStart: Date,
  windowEnd: Date,
  bucketMs: number
): { t: string; avgMs: number | null; n: number }[] {
  const ws = windowStart.getTime();
  const we = windowEnd.getTime();
  const buckets = new Map<number, { sum: number; n: number }>();

  for (const c of checks) {
    const t = c.checkedAt.getTime();
    if (t < ws || t > we) continue;
    if (!c.ok || c.responseTimeMs == null) continue;
    const b = Math.floor(t / bucketMs) * bucketMs;
    const cur = buckets.get(b) ?? { sum: 0, n: 0 };
    cur.sum += c.responseTimeMs;
    cur.n += 1;
    buckets.set(b, cur);
  }

  const keys = [...buckets.keys()].sort((a, b) => a - b);
  return keys.map((k) => {
    const { sum, n } = buckets.get(k)!;
    return { t: new Date(k).toISOString(), avgMs: n ? Math.round(sum / n) : null, n };
  });
}

export function buildIncidentList(checks: CheckIncidentSlice[], windowStart: Date, windowEnd: Date) {
  const ws = windowStart.getTime();
  const we = windowEnd.getTime();
  const inWindow = checks
    .filter((c) => {
      const t = c.checkedAt.getTime();
      return t >= ws && t <= we;
    })
    .sort((a, b) => a.checkedAt.getTime() - b.checkedAt.getTime());

  const incidents: {
    startedAt: string;
    endedAt: string | null;
    durationMs: number | null;
    summary: string;
  }[] = [];

  let open: { start: number; lastDown: number; summary: string } | null = null;

  for (const c of inWindow) {
    const t = c.checkedAt.getTime();
    if (!c.ok) {
      if (!open) {
        open = {
          start: t,
          lastDown: t,
          summary: c.errorMessage ?? `HTTP ${c.httpStatus ?? "?"}`,
        };
      } else {
        open.lastDown = t;
        if (c.errorMessage) open.summary = c.errorMessage;
      }
    } else if (open) {
      incidents.push({
        startedAt: new Date(open.start).toISOString(),
        endedAt: new Date(t).toISOString(),
        durationMs: t - open.start,
        summary: open.summary,
      });
      open = null;
    }
  }

  if (open) {
    incidents.push({
      startedAt: new Date(open.start).toISOString(),
      endedAt: null,
      durationMs: we - open.start,
      summary: open.summary,
    });
  }

  return incidents;
}
