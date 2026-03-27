const base = "";

/** Prevents indefinite "Loading…" when the browser fetch never completes (ALB / network hang). */
const FETCH_TIMEOUT_MS = 25_000;

function mergeSignals(a: AbortSignal, b?: AbortSignal): AbortSignal {
  if (!b) return a;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([a, b]);
  return a;
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
  if (b.length > 0 && b.length < 500 && !b.includes("<")) return b;
  return `Request failed (${status})`;
}

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const isIdempotent = method === "GET" || method === "HEAD";
  const maxAttempts = isIdempotent ? 4 : 1;

  let lastErr = "Request failed";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const signal = mergeSignals(timeoutSignal, init?.signal);

    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        ...init,
        signal,
        headers: { "Content-Type": "application/json", ...init?.headers },
      });
    } catch (e) {
      const aborted =
        e instanceof Error &&
        (e.name === "AbortError" || (e instanceof DOMException && e.name === "AbortError"));
      if (aborted) {
        lastErr =
          timeoutSignal.aborted && !(init?.signal?.aborted ?? false)
            ? `Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`
            : "Request aborted";
        if (attempt < maxAttempts && isIdempotent) {
          await new Promise((r) => setTimeout(r, 300 * attempt));
          continue;
        }
        throw new Error(lastErr);
      }
      throw e;
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

export function listTargets() {
  return j<Target[]>("/api/targets");
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
  return j<Stats>(`/api/targets/${id}/stats?window=${window}`);
}

export type IncidentsRes = {
  window: string;
  items: { startedAt: string; endedAt: string | null; durationMs: number | null; summary: string }[];
  checksTruncated?: boolean;
};

export function getIncidents(id: string, window: "24h" | "7d" | "30d") {
  return j<IncidentsRes>(`/api/targets/${id}/incidents?window=${window}`);
}

export type LatencySeries = {
  series: { t: string; avgMs: number | null; n: number }[];
  checksTruncated?: boolean;
};

export function getLatencySeries(id: string) {
  return j<LatencySeries>(`/api/targets/${id}/latency-series`);
}
