import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  getIncidents,
  getLatencySeries,
  getStats,
  listTargets,
  type IncidentsRes,
  type LatencySeries,
  type Stats,
  type Target,
} from "../api";

type Win = "24h" | "7d" | "30d";

export default function TargetDetail() {
  const { id } = useParams();
  const [target, setTarget] = useState<Target | null>(null);
  const [timeWindow, setTimeWindow] = useState<Win>("24h");
  const [stats, setStats] = useState<Stats | null>(null);
  const [incidents, setIncidents] = useState<IncidentsRes | null>(null);
  const [series, setSeries] = useState<LatencySeries | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void listTargets()
      .then((all) => setTarget(all.find((t) => t.id === id) ?? null))
      .catch(() => setTarget(null));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const targetId = id;
    let cancelled = false;
    async function load() {
      setErr(null);
      try {
        const [s, i, l] = await Promise.all([
          getStats(targetId, timeWindow),
          getIncidents(targetId, timeWindow),
          getLatencySeries(targetId),
        ]);
        if (!cancelled) {
          setStats(s);
          setIncidents(i);
          setSeries(l);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Load failed");
      }
    }
    void load();
    const t = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [id, timeWindow]);

  if (!id) return null;

  const chartData =
    series?.series.map((p) => ({
      t: new Date(p.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      avgMs: p.avgMs ?? 0,
      n: p.n,
    })) ?? [];

  return (
    <div className="space-y-8">
      <div>
        <Link to="/" className="text-sm text-zinc-500 hover:text-emerald-400">
          ← All targets
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-white">
          {target?.name || target?.url || "Target"}
        </h1>
        {target && <p className="mt-1 truncate text-sm text-zinc-500">{target.url}</p>}
      </div>

      {err && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {err}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(["24h", "7d", "30d"] as const).map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setTimeWindow(w)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              timeWindow === w
                ? "bg-emerald-600 text-white"
                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            {w}
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Uptime"
          value={stats?.uptimePercent == null ? "n/a" : `${stats.uptimePercent.toFixed(3)}%`}
        />
        <StatCard label="Incidents" value={String(stats?.incidentCount ?? "—")} />
        <StatCard
          label="p50 / p95"
          value={
            stats ? `${stats.p50Ms ?? "—"} ms / ${stats.p95Ms ?? "—"} ms` : "—"
          }
        />
        <StatCard
          label="Longest outage"
          value={
            stats?.longestOutageMs ? `${Math.round(stats.longestOutageMs / 1000)}s` : "0s"
          }
        />
      </div>

      {stats?.methodology && <p className="text-xs text-zinc-600">{stats.methodology}</p>}

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h2 className="text-lg font-medium text-white">Response time (24h, 1-min buckets)</h2>
        <div className="mt-4 h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
              <XAxis dataKey="t" stroke="#71717a" tick={{ fontSize: 11 }} />
              <YAxis stroke="#71717a" tick={{ fontSize: 11 }} unit=" ms" />
              <Tooltip
                contentStyle={{ background: "#18181b", border: "1px solid #3f3f46" }}
                labelStyle={{ color: "#a1a1aa" }}
              />
              <Line type="monotone" dataKey="avgMs" stroke="#34d399" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h2 className="text-lg font-medium text-white">Incidents</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {(incidents?.items.length ?? 0) === 0 && (
            <li className="text-zinc-500">No incidents in this window.</li>
          )}
          {incidents?.items.map((it, i) => (
            <li
              key={`${it.startedAt}-${i}`}
              className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2"
            >
              <div className="font-medium text-zinc-200">
                {new Date(it.startedAt).toLocaleString()}
                {it.endedAt ? ` → ${new Date(it.endedAt).toLocaleString()}` : " → ongoing"}
              </div>
              <div className="text-zinc-500">
                {it.durationMs != null ? `${Math.round(it.durationMs / 1000)}s` : "—"} · {it.summary}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-white">{value}</div>
    </div>
  );
}
