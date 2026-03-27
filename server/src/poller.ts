import PQueue from "p-queue";
import { insertCheck } from "./repo/checks.js";
import { listEnabledTargets } from "./repo/targets.js";
import { postSlackTransition } from "./slack.js";

function readBodyMaxBytes(): number {
  const n = parseInt(process.env.READ_BODY_MAX_BYTES ?? "16384", 10);
  return Number.isFinite(n) && n >= 2048 && n <= 131_072 ? n : 16_384;
}

/** Cap bytes read per check (keyword mode); default 16KiB for low RAM. Override READ_BODY_MAX_BYTES. */
const READ_BODY_MAX = readBodyMaxBytes();

type TargetRow = {
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
};

type PollerState = {
  consecutiveFail: number;
  consecutiveOk: number;
  slackNotified: "UP" | "DOWN" | null;
};

const targetState = new Map<string, PollerState>();
const lastRunAt = new Map<string, number>();

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const failuresBeforeDown = envInt("FLAP_FAILURES_BEFORE_DOWN", 3);
const successesBeforeUp = envInt("FLAP_SUCCESSES_BEFORE_UP", 2);
const concurrency = envInt("POLL_CONCURRENCY", 1);

const queue = new PQueue({ concurrency });

async function runOneCheck(t: TargetRow): Promise<void> {
  const started = Date.now();
  let ok = false;
  let httpStatus: number | null = null;
  let errorMessage: string | null = null;
  let bodySnippet: string | null = null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), t.timeoutMs);

  try {
    const res = await fetch(t.url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "HealthMonitor/1.0" },
    });
    httpStatus = res.status;
    const inRange = httpStatus >= t.statusMin && httpStatus <= t.statusMax;
    if (!inRange) {
      errorMessage = `Status ${httpStatus} outside ${t.statusMin}–${t.statusMax}`;
      await res.body?.cancel?.();
    } else if (t.keyword) {
      const text = await readBodySnippet(res);
      bodySnippet = text.slice(0, 500);
      if (!text.includes(t.keyword)) {
        errorMessage = `Body missing keyword "${t.keyword}"`;
        ok = false;
      } else {
        ok = true;
      }
    } else {
      await res.body?.cancel?.();
      ok = true;
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      errorMessage = e.name === "AbortError" ? `Timeout after ${t.timeoutMs}ms` : e.message;
    } else {
      errorMessage = String(e);
    }
    ok = false;
  } finally {
    clearTimeout(timer);
  }

  const responseTimeMs = Date.now() - started;
  const checkedAt = new Date();

  try {
    await insertCheck({
      targetId: t.id,
      checkedAt,
      ok,
      httpStatus,
      responseTimeMs,
      errorMessage,
      bodySnippet,
    });
    await maybeAlertSlack(t, ok, checkedAt, responseTimeMs, errorMessage, httpStatus);
  } catch (e) {
    console.error("[poller] persist or slack failed", t.id, t.url, e);
  }
}

async function readBodySnippet(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let out = "";
  let total = 0;
  try {
    while (total < READ_BODY_MAX) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        out += decoder.decode(value, { stream: true });
      }
    }
    if (total >= READ_BODY_MAX) await reader.cancel().catch(() => {});
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
  return out;
}

async function maybeAlertSlack(
  t: TargetRow,
  ok: boolean,
  checkedAt: Date,
  responseTimeMs: number,
  errorMessage: string | null,
  httpStatus: number | null
): Promise<void> {
  let st = targetState.get(t.id);
  if (!st) {
    st = { consecutiveFail: 0, consecutiveOk: 0, slackNotified: null };
    targetState.set(t.id, st);
  }

  if (ok) {
    st.consecutiveOk += 1;
    st.consecutiveFail = 0;
  } else {
    st.consecutiveFail += 1;
    st.consecutiveOk = 0;
  }

  const display = t.name?.trim() || t.url;

  if (st.slackNotified !== "DOWN" && st.consecutiveFail >= failuresBeforeDown) {
    try {
      await postSlackTransition({
        targetName: display,
        url: t.url,
        state: "DOWN",
        checkedAt,
        responseTimeMs: ok ? responseTimeMs : null,
        errorMessage,
        httpStatus,
      });
      st.slackNotified = "DOWN";
    } catch (e) {
      console.error("[poller] slack DOWN notify failed", t.id, e);
    }
  }

  if (st.slackNotified === "DOWN" && st.consecutiveOk >= successesBeforeUp) {
    try {
      await postSlackTransition({
        targetName: display,
        url: t.url,
        state: "UP",
        checkedAt,
        responseTimeMs,
        errorMessage: null,
        httpStatus,
      });
      st.slackNotified = "UP";
    } catch (e) {
      console.error("[poller] slack UP notify failed", t.id, e);
    }
  }

  if (st.slackNotified === null && ok && st.consecutiveOk >= 1) {
    st.slackNotified = "UP";
  }
}

export function startPoller(globalPollTickMs = 1000): () => void {
  const tick = async () => {
    try {
      const targets = await listEnabledTargets();
      const now = Date.now();
      for (const t of targets) {
        const last = lastRunAt.get(t.id) ?? 0;
        const intervalMs = Math.max(1, t.pollIntervalSec) * 1000;
        if (now - last >= intervalMs) {
          lastRunAt.set(t.id, now);
          void queue
            .add(() => runOneCheck(t as TargetRow))
            .catch((e) => console.error("[poller] check error", t.id, e));
        }
      }
    } catch (e) {
      console.error("[poller] tick error", e);
    }
  };

  const id = setInterval(tick, globalPollTickMs);
  void tick();
  return () => clearInterval(id);
}
