import "dotenv/config";
import { fetchChecksBudgetedStats } from "../check-query.js";
import { pool } from "../db.js";
import { listTargetsOrderByCreated } from "../repo/targets.js";
import { computeUptimeAndIncidents, percentile, windowBounds } from "../stats.js";
import { postSlackWeeklyReport, slackWebhookConfigured } from "../slack.js";
import type { Target } from "../types.js";

async function main() {
  const { start, end } = windowBounds("7d");
  let targets: Target[];
  try {
    targets = await listTargetsOrderByCreated();
  } catch (e) {
    console.error("[weekly-report] failed to load targets", e);
    process.exit(1);
    return;
  }

  const lines: string[] = [
    ":bar_chart: *Weekly performance summary* (rolling 7 days)",
    `Window: ${start.toISOString()} → ${end.toISOString()}`,
    "",
  ];

  for (const t of targets) {
    try {
      const { rows: checks } = await fetchChecksBudgetedStats(t.id, start, end);
      const u = computeUptimeAndIncidents(checks, start, end);
      const sorted = [...u.latenciesMs].sort((a, b) => a - b);
      const p50 = percentile(sorted, 50);
      const p95 = percentile(sorted, 95);
      const name = t.name?.trim() || t.url;
      const up = u.uptimePercent == null ? "n/a (no checks)" : `${u.uptimePercent.toFixed(3)}%`;
      lines.push(`*${name}*`);
      lines.push(`  • Uptime: ${up}`);
      lines.push(`  • Incidents: ${u.incidentCount}`);
      lines.push(`  • Latency p50/p95: ${p50 ?? "n/a"} ms / ${p95 ?? "n/a"} ms (successful checks)`);
      lines.push(
        `  • Longest outage: ${u.longestOutageMs ? `${Math.round(u.longestOutageMs / 1000)}s` : "0s"}`
      );
      lines.push("");
    } catch (e) {
      const name = t.name?.trim() || t.url;
      console.error("[weekly-report] target skipped", name, e);
      lines.push(`*${name}*`);
      lines.push(`  • _Error loading stats (skipped)_`);
      lines.push("");
    }
  }

  lines.push("_Methodology: uptime is time-weighted between checks; lead gap excluded._");

  const report = lines.join("\n");
  console.log(report);

  if (slackWebhookConfigured()) {
    try {
      await postSlackWeeklyReport(report);
    } catch (e) {
      console.error("[weekly-report] Slack post failed", e);
      process.exit(1);
      return;
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
