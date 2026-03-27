import "dotenv/config";
import cors from "cors";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "./db.js";
import { registerApi } from "./routes/api.js";
import { startPoller } from "./poller.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

registerApi(app);

const staticDir = path.join(__dirname, "..", "public");
app.use(express.static(staticDir));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(staticDir, "index.html"), (err) => {
    if (err) next();
  });
});

const port = parseInt(process.env.PORT ?? "3000", 10);

const stopPoller = startPoller(1000);

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`[server] listening on 0.0.0.0:${port}`);
});

function shutdown(signal: string) {
  console.log(`[server] ${signal}, shutting down`);
  stopPoller();
  server.close(() => {
    void prisma
      .$disconnect()
      .catch(() => {})
      .finally(() => process.exit(0));
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
