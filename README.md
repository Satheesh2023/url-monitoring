# URL monitoring

Node.js + TypeScript API and poller, React + Vite + Tailwind UI, MySQL (Prisma), Slack alerts, Docker image, Kubernetes manifests (MySQL pod + app + weekly CronJob).

## Quick start (local)

1. MySQL running; set `DATABASE_URL` in `.env` (see `.env.example`).
2. `npm install` → `npm run db:generate -w server` → `npm run db:migrate -w server`
3. `npm run dev -w server` and `npm run dev -w web` → UI at http://localhost:5173

## Docker

```bash
docker build -t YOUR_USER/url-monitoring:latest .
```

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
