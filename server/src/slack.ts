/**
 * Incoming webhook integration (https://api.slack.com/messaging/webhooks).
 * Set SLACK_WEBHOOK_URL; optional SLACK_CHANNEL if your app supports override.
 *
 * Note: With multiple app replicas, each process keeps its own last-known status — you may
 * receive duplicate UP/DOWN posts unless you run one replica or add shared state later.
 */

export type SlackTransitionInput = {
  targetName: string;
  url: string;
  state: "UP" | "DOWN";
  checkedAt: Date;
  responseTimeMs: number | null;
  errorMessage: string | null;
  httpStatus: number | null;
};

export function slackWebhookConfigured(): boolean {
  return Boolean(process.env.SLACK_WEBHOOK_URL?.trim());
}

function webhookUrl(): string | undefined {
  const u = process.env.SLACK_WEBHOOK_URL?.trim();
  return u || undefined;
}

function escapeMrkdwn(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function postSlackPayload(payload: Record<string, unknown>): Promise<void> {
  const url = webhookUrl();
  if (!url) return;
  const ch = process.env.SLACK_CHANNEL?.trim();
  if (ch) (payload as { channel?: string }).channel = ch;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Slack webhook HTTP ${res.status}: ${t.slice(0, 500)}`);
  }
}

export async function postSlackTransition(input: SlackTransitionInput): Promise<void> {
  if (!webhookUrl()) return;

  const emoji = input.state === "DOWN" ? ":rotating_light:" : ":white_check_mark:";
  const head = input.state === "DOWN" ? "URL DOWN" : "URL recovered";
  const parts: string[] = [
    `${emoji} *${head}*`,
    `*${escapeMrkdwn(input.targetName)}*`,
    escapeMrkdwn(input.url),
    `_${escapeMrkdwn(input.checkedAt.toISOString())}_`,
  ];
  if (input.state === "DOWN") {
    if (input.httpStatus != null) parts.push(`HTTP \`${input.httpStatus}\``);
    if (input.errorMessage) {
      parts.push(`> ${escapeMrkdwn(input.errorMessage).slice(0, 800)}`);
    }
  } else if (input.responseTimeMs != null) {
    parts.push(`Response time: *${input.responseTimeMs}* ms`);
  }

  const mrkdwn = parts.join("\n");
  await postSlackPayload({
    blocks: [{ type: "section", text: { type: "mrkdwn", text: mrkdwn } }],
    text: `${head}: ${input.targetName}`,
  });
}

/** Section mrkdwn max ~3000 chars; split on line boundaries when the report is long. */
function chunkMrkdwn(text: string, maxLen = 2800): string[] {
  const lines = text.split("\n");
  const chunks: string[] = [];
  let cur = "";

  function flushOversized(buf: string): string {
    let rest = buf;
    while (rest.length > maxLen) {
      chunks.push(rest.slice(0, maxLen));
      rest = rest.slice(maxLen);
    }
    return rest;
  }

  for (const line of lines) {
    const next = cur ? `${cur}\n${line}` : line;
    if (next.length > maxLen && cur) {
      chunks.push(cur);
      cur = flushOversized(line);
    } else if (line.length > maxLen) {
      if (cur) {
        chunks.push(cur);
        cur = "";
      }
      cur = flushOversized(line);
    } else {
      cur = next;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export async function postSlackWeeklyReport(fullText: string): Promise<void> {
  if (!webhookUrl()) {
    console.warn("[slack] SLACK_WEBHOOK_URL not set; skipping Slack post");
    return;
  }
  const chunks = chunkMrkdwn(fullText);
  for (let i = 0; i < chunks.length; i++) {
    const part = chunks.length > 1 ? `*(part ${i + 1}/${chunks.length})*\n${chunks[i]}` : chunks[i];
    await postSlackPayload({
      blocks: [{ type: "section", text: { type: "mrkdwn", text: part } }],
      text: "Weekly URL monitoring report",
    });
  }
}
