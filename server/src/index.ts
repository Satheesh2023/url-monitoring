import "dotenv/config";
import cors from "cors";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./db.js";
import { registerApi } from "./routes/api.js";
import { startPoller } from "./poller.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const POLLER_START_DELAY_MS = 2500;
const JSON_BODY_LIMIT = "256kb";

const app = express();
app.set("trust proxy", 1);
const corsOrigins = process.env.CORS_ORIGIN?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: corsOrigins && corsOrigins.length > 0 ? corsOrigins : true,
  })
);
app.use(express.json({ limit: JSON_BODY_LIMIT }));

registerApi(app);

/** Unmatched /api/* → JSON 404 (avoid sending SPA HTML to API clients). */
app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) return next();
  res.status(404).json({ error: "not found" });
});

const staticDir = path.join(__dirname, "..", "public");
app.use(express.static(staticDir));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(staticDir, "index.html"), (err) => {
    if (err) next();
  });
});

const rawPort = process.env.PORT ?? "3000";
const port = parseInt(rawPort, 10);
if (!Number.isFinite(port) || port < 1 || port > 65535) {
  console.error("[server] invalid PORT:", rawPort);
  process.exit(1);
}

/** Start poller only after HTTP is listening so /api/health passes probes immediately. */
let stopPoller: (() => void) | undefined;
let pollerStartTimer: ReturnType<typeof setTimeout> | undefined;

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`[server] listening on 0.0.0.0:${port}`);
  pollerStartTimer = setTimeout(() => {
    pollerStartTimer = undefined;
    try {
      stopPoller = startPoller(1000);
    } catch (e) {
      console.error("[server] startPoller failed", e);
    }
  }, POLLER_START_DELAY_MS);
});

server.on("error", (err) => {
  console.error("[server] listen failed", err);
  process.exit(1);
});

function shutdown(signal: string) {
  console.log(`[server] ${signal}, shutting down`);
  if (pollerStartTimer) {
    clearTimeout(pollerStartTimer);
    pollerStartTimer = undefined;
  }
  stopPoller?.();
  server.close(() => {
    void pool
      .end()
      .catch(() => {})
      .finally(() => process.exit(0));
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandledRejection", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[server] uncaughtException", err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
