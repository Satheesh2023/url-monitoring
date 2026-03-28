const base = "";

/** Prevents indefinite "Loading…" when the browser fetch never completes (ALB / network hang). */
const FETCH_TIMEOUT_MS = 25_000;
/** `/api/targets` can be slower (DB); keep above default so list view does not false-timeout. */
const LIST_TARGETS_TIMEOUT_MS = 60_000;
/** Stats / incidents / latency run heavy queries (COUNT + bounded reads). */
const DETAIL_STATS_TIMEOUT_MS = 90_000;

function mergeSignals(a: AbortSignal, b?: AbortSignal): AbortSignal {
  if (!b) return a;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([a, b]);
  return a;
}

function userFacingNetworkError(e: unknown, timedOut: boolean, timeoutMs: number): Error {
  const sec = timeoutMs / 1000;
  if (timedOut) {
    return new Error(
      `Request timed out after ${sec}s — the API or database may be slow or unavailable.`
    );
  }
  if (e instanceof Error) {
    const m = e.message;
    if (/signal.*timed out|TimeoutError|timed out|aborted due to timeout/i.test(m)) {
      return new Error(
        `Request timed out after ${sec}s — the API or database may be slow or unavailable.`
      );
    }
    return e;
  }
  return new Error(String(e));
}

function formatHttpError(status: number, body: string): string {
  const b = body.trim();
  if (
    b.toLowerCase().startsWith("<!doctype") ||
    b.includes("<html") ||
    b.includes("<HTML")
  ) {
    return `Gateway error (${status}): load balancer had no healthy backend (often brief). Retried automatically.`;
  }
  if (b.length > 0 && b.length < 500 && !b.includes("<")) {
    try {
      const parsed = JSON.parse(b) as { error?: string };
      if (typeof parsed.error === "string") return parsed.error;
    } catch {
      /* not JSON */
    }
    return b;
  }
  return `Request failed (${status})`;
}

type JInit = RequestInit & { timeoutMs?: number };

async function j<T>(path: string, init?: JInit): Promise<T> {
  const { timeoutMs: customTimeout, ...restInit } = init ?? {};
  const timeoutMs =
    typeof customTimeout === "number" && customTimeout > 0 ? customTimeout : FETCH_TIMEOUT_MS;
  const method = (restInit.method ?? "GET").toUpperCase();
  const isIdempotent = method === "GET" || method === "HEAD";
  const maxAttempts = isIdempotent ? 4 : 1;

  let lastErr = "Request failed";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = mergeSignals(timeoutSignal, restInit.signal);

    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        ...restInit,
        signal,
        headers: { "Content-Type": "application/json", ...restInit.headers },
      });
    } catch (e) {
      const aborted =
        e instanceof Error &&
        (e.name === "AbortError" || (e instanceof DOMException && e.name === "AbortError"));
      if (aborted) {
        const timedOut = timeoutSignal.aborted && !(restInit.signal?.aborted ?? false);
        if (attempt < maxAttempts && isIdempotent) {
          await new Promise((r) => setTimeout(r, 300 * attempt));
          continue;
        }
        throw userFacingNetworkError(e, timedOut, timeoutMs);
      }
      throw userFacingNetworkError(e, false, timeoutMs);
    }

    if (res.ok) {
      if (res.status === 204) return undefined as T;
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        const t = await res.text();
        throw new Error(formatHttpError(res.status, t));
      }
      return res.json() as Promise<T>;
    }

    const text = await res.text();
    lastErr = formatHttpError(res.status, text);

    if (
      attempt < maxAttempts &&
      (res.status === 502 || res.status === 503 || res.status === 504)
    ) {
      await new Promise((r) => setTimeout(r, 300 * attempt));
      continue;
    }
    throw new Error(lastErr);
  }
  throw new Error(lastErr);
}

export type Check = {
  id: string;
  targetId: string;
  checkedAt: string;
  ok: boolean;
  httpStatus: number | null;
  responseTimeMs: number | null;
  errorMessage: string | null;
  /** Omitted on list endpoint to save memory */
  bodySnippet?: string | null;
};

export type Target = {
  id: string;
  url: string;
  name: string | null;
  pollIntervalSec: number;
  timeoutMs: number;
  maxRedirects: number;
  statusMin: number;
  statusMax: number;
  keyword: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  latest: Check | null;
};

export type ListTargetsResult = { targets: Target[]; partialLatest: boolean };

export async function listTargets(): Promise<ListTargetsResult> {
  const raw = await j<unknown>("/api/targets", { timeoutMs: LIST_TARGETS_TIMEOUT_MS });
  if (Array.isArray(raw)) {
    return { targets: raw as Target[], partialLatest: false };
  }
  const o = raw as { targets?: unknown; partialLatest?: boolean };
  const targets = Array.isArray(o.targets) ? (o.targets as Target[]) : [];
  return { targets, partialLatest: o.partialLatest === true };
}

export function createTarget(body: Record<string, unknown>) {
  return j<Target>("/api/targets", { method: "POST", body: JSON.stringify(body) });
}

export function deleteTarget(id: string) {
  return j<void>(`/api/targets/${id}`, { method: "DELETE" });
}

export type Stats = {
  window: string;
  uptimePercent: number | null;
  incidentCount: number;
  p50Ms: number | null;
  p95Ms: number | null;
  longestOutageMs: number;
  checkCount?: number;
  checksLoaded?: number;
  checksTruncated?: boolean;
  methodology: string;
};

export function getStats(id: string, window: "24h" | "7d" | "30d") {
  return j<Stats>(`/api/targets/${id}/stats?window=${window}`, {
    timeoutMs: DETAIL_STATS_TIMEOUT_MS,
  });
}

export type IncidentsRes = {
  window: string;
  items: { startedAt: string; endedAt: string | null; durationMs: number | null; summary: string }[];
  checksTruncated?: boolean;
};

export function getIncidents(id: string, window: "24h" | "7d" | "30d") {
  return j<IncidentsRes>(`/api/targets/${id}/incidents?window=${window}`, {
    timeoutMs: DETAIL_STATS_TIMEOUT_MS,
  });
}

export type LatencySeries = {
  series: { t: string; avgMs: number | null; n: number }[];
  checksTruncated?: boolean;
};

export function getLatencySeries(id: string) {
  return j<LatencySeries>(`/api/targets/${id}/latency-series`, {
    timeoutMs: DETAIL_STATS_TIMEOUT_MS,
  });
}

export type DashboardRes = {
  stats: Stats & {
    windowStart?: string;
    windowEnd?: string;
    coveredMs?: number;
    downtimeMs?: number;
    checksLoaded?: number;
  };
  incidents: IncidentsRes;
  latencySeries: LatencySeries;
};

/** One round-trip: stats + incidents + 24h latency chart (server uses one DB pass for 24h window). */
export function getDashboard(id: string, window: "24h" | "7d" | "30d") {
  return j<DashboardRes>(`/api/targets/${id}/dashboard?window=${window}`, {
    timeoutMs: DETAIL_STATS_TIMEOUT_MS,
  });
}
