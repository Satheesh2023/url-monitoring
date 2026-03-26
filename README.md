# URL monitoring

Node.js + TypeScript API and poller, React + Vite + Tailwind UI, MySQL (Prisma), Slack alerts, Docker image, Kubernetes manifests (MySQL pod + app + weekly CronJob).

## Quick start (local)

1. MySQL running; set `DATABASE_URL` in `.env` (see `.env.example`).
2. `npm install` → `npm run db:generate -w server` → `npm run db:migrate -w server`
3. `npm run dev -w server` and `npm run dev -w web` → UI at http://localhost:5173

## Docker

```bash
docker build -t YOUR_USER/health-monitor:latest .
```

## Kubernetes

Edit `k8s/01-mysql-secret.yaml`, image name in `03-app.yaml` / `04-cronjob-weekly.yaml`, then `kubectl apply -f k8s/`.

## GitHub → Docker Hub

Set secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` on the repo.
