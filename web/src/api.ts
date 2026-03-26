const base = "";

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type Check = {
  id: string;
  targetId: string;
  checkedAt: string;
  ok: boolean;
  httpStatus: number | null;
  responseTimeMs: number | null;
  errorMessage: string | null;
  bodySnippet: string | null;
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
  methodology: string;
};

export function getStats(id: string, window: "24h" | "7d" | "30d") {
  return j<Stats>(`/api/targets/${id}/stats?window=${window}`);
}

export type IncidentsRes = {
  window: string;
  items: { startedAt: string; endedAt: string | null; durationMs: number | null; summary: string }[];
};

export function getIncidents(id: string, window: "24h" | "7d" | "30d") {
  return j<IncidentsRes>(`/api/targets/${id}/incidents?window=${window}`);
}

export type LatencySeries = {
  series: { t: string; avgMs: number | null; n: number }[];
};

export function getLatencySeries(id: string) {
  return j<LatencySeries>(`/api/targets/${id}/latency-series`);
}
