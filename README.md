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
docker build --platform linux/amd64 -t YOUR_USER/url-monitoring:local .
```

### CI on GitHub

Workflow [**CI — npm build and Docker**](.github/workflows/ci.yml) runs `npm ci` → native Linux deps → Prisma → web + server build, then validates the `Dockerfile` with buildx. On `main`/`master` it also logs in and pushes the image. Failures in the npm steps surface in the same job log before Docker runs.

## Kubernetes

Edit `k8s/01-mysql-secret.yaml`, set the app image in `03-app.yaml` and `04-cronjob-weekly.yaml` to `YOUR_DOCKERHUB_USER/url-monitoring:<5-char-prefix>` (CI pushes the **first 5 hex characters** of that commit’s SHA as the tag), then `kubectl apply -f k8s/`.

## CI: build and push (GitHub Actions)

Workflow: [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

| Trigger | What happens |
|--------|----------------|
| Push to `main` / `master` | Builds image and pushes `…/url-monitoring:<first-5-of-sha>` (no `:latest`) |
| Pull request | Builds only (validates `Dockerfile`; no push, no Docker Hub login needed on forks) |
| **Actions → Run workflow** | Same as push (manual build + push) |

**Repository secrets:** `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` (Docker Hub [access token](https://hub.docker.com/settings/security)).
