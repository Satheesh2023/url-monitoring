import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { createTarget, deleteTarget, listTargets, type Target } from "../api";

const TARGETS_CACHE_KEY = "hm-targets-list-v1";
/** Keeps Aurora read QPS down vs 5s polling × tabs × replicas. */
const LIST_REFRESH_MS = 20_000;

function readCachedTargets(): Target[] {
  try {
    const raw = sessionStorage.getItem(TARGETS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Target[]) : [];
  } catch {
    return [];
  }
}

function writeCachedTargets(data: Target[]) {
  try {
    sessionStorage.setItem(TARGETS_CACHE_KEY, JSON.stringify(data));
  } catch {
    /* quota / private mode */
  }
}

function formatTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default function TargetList() {
  const cached = readCachedTargets();
  const [targets, setTargets] = useState<Target[]>(cached);
  /** Only block the table on first load when we have nothing to show yet */
  const [loading, setLoading] = useState(cached.length === 0);
  const [err, setErr] = useState<string | null>(null);
  /** True when a refresh failed but we still show the last successful list */
  const [stale, setStale] = useState(false);
  /** Last successful response: API returned targets but latest-check query failed (DB issue). */
  const [partialLatest, setPartialLatest] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "up" | "down">("all");

  const filteredTargets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return targets.filter((t) => {
      if (statusFilter === "up" && t.latest?.ok !== true) return false;
      if (statusFilter === "down" && t.latest?.ok !== false) return false;
      if (!q) return true;
      const inUrl = t.url.toLowerCase().includes(q);
      const inName = (t.name ?? "").toLowerCase().includes(q);
      return inUrl || inName;
    });
  }, [targets, search, statusFilter]);

  async function refresh() {
    try {
      const { targets: data, partialLatest: partial } = await listTargets();
      setTargets(data);
      writeCachedTargets(data);
      setPartialLatest(partial);
      setErr(null);
      setStale(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
      setStale(true);
      // Do not clear targets — avoids "No targets yet" during transient 503 / ALB blips.
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), LIST_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await createTarget({ url, name: name || null });
      setName("");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Create failed");
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this target?")) return;
    try {
      await deleteTarget(id);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Targets</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Live status refreshes every 20s. Open a row for history, uptime, and latency.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-1 text-sm">
            {(
              [
                { id: "all" as const, label: "All" },
                { id: "up" as const, label: "Up" },
                { id: "down" as const, label: "Down" },
              ] satisfies { id: "all" | "up" | "down"; label: string }[]
            ).map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setStatusFilter(id)}
                className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                  statusFilter === id
                    ? id === "up"
                      ? "bg-emerald-600 text-white"
                      : id === "down"
                        ? "bg-red-600 text-white"
                        : "bg-zinc-700 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="min-w-[200px] flex-1 sm:max-w-md">
            <label htmlFor="target-search" className="sr-only">
              Search by URL or name
            </label>
            <input
              id="target-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search URL or name…"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 outline-none ring-emerald-500/40 placeholder:text-zinc-600 focus:ring-2"
              autoComplete="off"
            />
          </div>
        </div>
      </div>

      <form
        onSubmit={onAdd}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
      >
        <div className="min-w-[200px] flex-1">
          <label className="block text-xs font-medium text-zinc-500">URL</label>
          <input
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://api.example/health"
            required
          />
        </div>
        <div className="w-48">
          <label className="block text-xs font-medium text-zinc-500">Name (optional)</label>
          <input
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="API"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Add target
        </button>
      </form>

      {stale && targets.length > 0 && (
        <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
          <p className="font-medium text-amber-50">Cached list — live refresh failed</p>
          <p className="mt-1 text-amber-100/90">
            Up / Down below is from the last successful load and may be wrong. Retrying every 20s.
          </p>
        </div>
      )}

      {stale && targets.length === 0 && !loading && (
        <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
          <p className="font-medium text-amber-50">Could not load targets</p>
          <p className="mt-1 text-amber-100/90">
            The API did not respond in time or returned an error. Retrying every 20s.
          </p>
        </div>
      )}

      {!stale && partialLatest && (
        <div className="rounded-lg border border-sky-800/60 bg-sky-950/30 px-3 py-2 text-sm text-sky-100">
          <p className="font-medium text-sky-50">Latest check data unavailable</p>
          <p className="mt-1 text-sky-100/90">
            Targets loaded, but the database could not return probe results (e.g. Aurora{" "}
            <code className="rounded bg-sky-950 px-1 text-xs">/rdsdbdata/tmp</code> full or DB
            overload). Status shows <span className="font-medium">No data</span> until the DB
            recovers. Retrying every 20s.
          </p>
        </div>
      )}

      {err && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {err}
        </div>
      )}

      {loading && targets.length === 0 ? (
        <p className="text-zinc-500">Loading…</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-900/80 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Name / URL</th>
                <th className="px-4 py-3">Last check</th>
                <th className="px-4 py-3">Latency</th>
                <th className="px-4 py-3">Hint</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 bg-zinc-950/40">
              {filteredTargets.map((t) => {
                const ok = t.latest?.ok;
                const baseBadge =
                  ok === undefined
                    ? {
                        label: "No data",
                        dot: "bg-zinc-500",
                        cls: "border border-zinc-600 bg-zinc-800/80 text-zinc-100",
                      }
                    : ok
                      ? {
                          label: "Up",
                          dot: "bg-emerald-400",
                          cls: "border border-emerald-600/50 bg-emerald-500/15 text-emerald-200",
                        }
                      : {
                          label: "Down",
                          dot: "bg-red-400",
                          cls: "border border-red-600/50 bg-red-500/15 text-red-200",
                        };
                const suffix = stale ? " · cached" : "";
                return (
                  <tr key={t.id} className="hover:bg-zinc-900/50">
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${baseBadge.cls}`}
                        title={
                          stale
                            ? "From last successful refresh; may be outdated"
                            : partialLatest && t.latest == null
                              ? "Database did not return latest check row"
                              : undefined
                        }
                      >
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${baseBadge.dot}`}
                          aria-hidden
                        />
                        {baseBadge.label}
                        {suffix && (
                          <span className="font-normal text-zinc-400">{suffix}</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/targets/${t.id}`}
                        className="font-medium text-white hover:text-emerald-400"
                      >
                        {t.name || t.url}
                      </Link>
                      <Link
                        to={`/targets/${t.id}`}
                        className="mt-0.5 block truncate text-xs text-zinc-500 hover:text-emerald-400/90"
                        title="Open uptime report"
                      >
                        {t.url}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{formatTime(t.latest?.checkedAt)}</td>
                    <td className="px-4 py-3 text-zinc-300">
                      {t.latest?.responseTimeMs != null ? `${t.latest.responseTimeMs} ms` : "—"}
                    </td>
                    <td
                      className="max-w-xs truncate text-zinc-500"
                      title={t.latest?.errorMessage ?? ""}
                    >
                      {t.latest?.ok === false ? (t.latest?.errorMessage ?? "Down") : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => void onDelete(t.id)}
                        className="text-xs text-zinc-500 hover:text-red-400"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {targets.length === 0 && (
            <p className="px-4 py-8 text-center text-zinc-500">No targets yet.</p>
          )}
          {targets.length > 0 && filteredTargets.length === 0 && (
            <p className="px-4 py-8 text-center text-zinc-500">
              No targets match your search or status filter.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
