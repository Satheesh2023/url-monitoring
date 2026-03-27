import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { createTarget, deleteTarget, listTargets, type Target } from "../api";

function formatTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default function TargetList() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  /** True when a refresh failed but we still show the last successful list */
  const [stale, setStale] = useState(false);
  const [url, setUrl] = useState("https://example.com");
  const [name, setName] = useState("");

  async function refresh() {
    try {
      const data = await listTargets();
      setTargets(data);
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
    const id = setInterval(() => void refresh(), 5000);
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
          Live status refreshes every 5s. Open a row for history, uptime, and latency.
        </p>
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
          Showing last loaded data — API was temporarily unreachable. Auto-refresh every 5s until it
          recovers.
        </div>
      )}

      {err && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {err}
        </div>
      )}

      {loading ? (
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
              {targets.map((t) => {
                const ok = t.latest?.ok;
                const badge =
                  ok === undefined
                    ? { label: "No data", cls: "bg-zinc-700 text-zinc-200" }
                    : ok
                      ? { label: "Up", cls: "bg-emerald-500/20 text-emerald-300" }
                      : { label: "Down", cls: "bg-red-500/20 text-red-300" };
                return (
                  <tr key={t.id} className="hover:bg-zinc-900/50">
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/targets/${t.id}`}
                        className="font-medium text-white hover:text-emerald-400"
                      >
                        {t.name || t.url}
                      </Link>
                      <div className="truncate text-xs text-zinc-500">{t.url}</div>
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
        </div>
      )}
    </div>
  );
}
