const MAX_SLACK = 3000;

let warnedMissingWebhook = false;

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

/** If set (e.g. #alerts or C0123…), included in webhook JSON — Slack may ignore if webhook is single-channel. */
function webhookBody(text: string): { text: string; channel?: string } {
  const t = truncate(text, MAX_SLACK);
  const ch = process.env.SLACK_CHANNEL?.trim();
  return ch ? { channel: ch, text: t } : { text: t };
}

export type SlackState = "UP" | "DOWN";

export async function postSlackTransition(payload: {
  targetName: string;
  url: string;
  state: SlackState;
  checkedAt: Date;
  responseTimeMs: number | null;
  errorMessage: string | null;
  httpStatus: number | null;
}): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    if (!warnedMissingWebhook) {
      console.warn("[slack] SLACK_WEBHOOK_URL not set; skipping notifications (this message logs once)");
      warnedMissingWebhook = true;
    }
    return;
  }

  const emoji = payload.state === "UP" ? ":large_green_circle:" : ":red_circle:";
  const lines = [
    `${emoji} *${payload.state}* — ${payload.targetName}`,
    `URL: ${payload.url}`,
    `Time: ${payload.checkedAt.toISOString()}`,
  ];
  if (payload.state === "DOWN") {
    if (payload.httpStatus != null) lines.push(`HTTP: ${payload.httpStatus}`);
    if (payload.errorMessage) lines.push(`Error: ${truncate(payload.errorMessage, 800)}`);
  } else if (payload.responseTimeMs != null) {
    lines.push(`Response: ${payload.responseTimeMs} ms`);
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(webhookBody(lines.join("\n"))),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[slack] webhook failed", res.status, body);
  }
}

export async function postSlackWeeklyReport(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    if (!warnedMissingWebhook) {
      console.warn("[slack] SLACK_WEBHOOK_URL not set; skipping weekly report (this message logs once)");
      warnedMissingWebhook = true;
    }
    return;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(webhookBody(text)),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[slack] weekly webhook failed", res.status, body);
  }
}
