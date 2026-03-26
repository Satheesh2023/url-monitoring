# URL monitoring

Node.js + TypeScript API and poller, React + Vite + Tailwind UI, MySQL (Prisma), Slack alerts, Docker image, Kubernetes manifests (MySQL pod + app + weekly CronJob).

## Quick start (local)

1. MySQL running; set `DATABASE_URL` in `.env` (see `.env.example`).
2. `npm install` → `npm run db:generate -w server` → `npm run db:migrate -w server`
3. `npm run dev -w server` and `npm run dev -w web` → UI at http://localhost:5173

## Docker

**Commit `package-lock.json`** — the `Dockerfile` uses `npm ci` and will fail if the lockfile is missing or out of sync with `package.json`.

### Verify locally (same steps as the image build)

```bash
bash scripts/verify-build.sh
```

That runs `npm ci` → Prisma generate → web + server build, then (if `docker` exists) `docker build --platform linux/amd64` so you match **GitHub Actions** (even on Apple Silicon).

Manual:

```bash
npm ci
npm run db:generate -w server
npm run build -w web
npm run build -w server
docker build --platform linux/amd64 -t YOUR_USER/url-monitoring:latest .
```

### Preflight on GitHub

Workflow **“Preflight — npm build (Linux)”** runs the same npm steps on `ubuntu-latest` with full logs. If preflight is green but **Docker build and push** is red, inspect Docker/buildx cache or build context.

## Kubernetes

Edit `k8s/01-mysql-secret.yaml`, replace `YOUR_DOCKERHUB_USER/url-monitoring:latest` in `03-app.yaml` and `04-cronjob-weekly.yaml`, then `kubectl apply -f k8s/`.

## CI: build and push (GitHub Actions)

Workflow: [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml).

| Trigger | What happens |
|--------|----------------|
| Push to `main` / `master` | Builds image and pushes `…/url-monitoring:latest` and `…/url-monitoring:<full-sha>` |
| Pull request | Builds only (validates `Dockerfile`; no push, no Docker Hub login needed on forks) |
| **Actions → Run workflow** | Same as push (manual build + push) |

**Repository secrets:** `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` (Docker Hub [access token](https://hub.docker.com/settings/security)).
