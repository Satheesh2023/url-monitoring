#!/usr/bin/env bash
# Run the same steps as the Docker build stage (Linux-like deps are only in Docker).
# Usage: from repo root — bash scripts/verify-build.sh
# Optional: same as CI — docker build --platform linux/amd64 --progress=plain -t url-monitoring:test .

set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== Node ==="
node -v
npm -v

echo "=== npm ci (requires package-lock.json committed) ==="
npm ci

if [[ "$(uname -s)" == "Linux" ]]; then
  echo "=== Linux native optional deps (same as CI / Docker) ==="
  npm install --no-save \
    @rollup/rollup-linux-x64-gnu \
    lightningcss-linux-x64-gnu \
    @tailwindcss/oxide-linux-x64-gnu
fi

echo "=== Prisma generate ==="
npm run db:generate -w server

echo "=== Web (Vite) ==="
npm run build -w web

echo "=== Server (tsc) ==="
npm run build -w server

echo "=== OK — all build steps passed ==="
if command -v docker >/dev/null 2>&1; then
  echo "=== Docker (linux/amd64, matches GitHub Actions) ==="
  docker build --platform linux/amd64 --progress=plain -t url-monitoring:local-test .
  echo "=== Docker image url-monitoring:local-test OK ==="
else
  echo "(Skip Docker: docker not in PATH)"
fi
