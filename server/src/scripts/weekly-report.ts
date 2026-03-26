import "dotenv/config";
import { prisma } from "../db.js";
import { computeUptimeAndIncidents, percentile, windowBounds } from "../stats.js";
import { postSlackWeeklyReport } from "../slack.js";

async function main() {
  const { start, end } = windowBounds("7d");
  const targets = await prisma.target.findMany({ orderBy: { createdAt: "asc" } });

  const lines: string[] = [
    ":bar_chart: *Weekly performance summary* (rolling 7 days)",
    `Window: ${start.toISOString()} → ${end.toISOString()}`,
    "",
  ];

  for (const t of targets) {
    const checks = await prisma.check.findMany({
      where: { targetId: t.id, checkedAt: { gte: start, lte: end } },
      orderBy: { checkedAt: "asc" },
    });
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
  }

  lines.push("_Methodology: uptime is time-weighted between checks; lead gap excluded._");

  await postSlackWeeklyReport(lines.join("\n"));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
