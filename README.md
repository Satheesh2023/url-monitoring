# URL monitoring

Node.js + TypeScript API and poller, React + Vite + Tailwind UI, MySQL via **mysql2** (raw SQL, no Prisma), Slack alerts, Docker image, and **EKS** manifests under [`eks-deploy/`](eks-deploy/) (Aurora MySQL, not in-cluster DB).

## Quick start (local)

1. MySQL running; set `DATABASE_URL` in `.env` (see `.env.example`).
2. `npm install` → `npm run db:migrate -w server` (applies `server/sql/migrations/*.sql` once per file)
3. `npm run dev -w server` and `npm run dev -w web` → UI at http://localhost:5173

## Docker

**Commit `package-lock.json`** — the `Dockerfile` uses `npm ci` and will fail if the lockfile is missing or out of sync with `package.json`.

### Verify locally (same steps as the image build)

```bash
bash scripts/verify-build.sh
```

That runs `npm ci` → web + server build, then (if `docker` exists) `docker build --platform linux/amd64` so you match **GitHub Actions** (even on Apple Silicon).

Manual:

```bash
npm ci
npm run build -w web
npm run build -w server
docker build --platform linux/amd64 -t YOUR_USER/url-monitoring:local .
```

### CI on GitHub

Workflow [**CI — npm build and Docker**](.github/workflows/ci.yml) runs `npm ci` → native Linux deps → web + server build, then validates the `Dockerfile` with buildx. On `main`/`master` it also logs in and pushes the image. Failures in the npm steps surface in the same job log before Docker runs.

## Kubernetes (EKS)

See [`eks-deploy/README.md`](eks-deploy/README.md): create `app-secret`, set the image tag in `kustomization.yaml` / `deployment.yaml` (CI pushes `…/url-monitoring:<first-5-of-sha>`), then `kubectl apply -k eks-deploy/`.

## CI: build and push (GitHub Actions)

Workflow: [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

| Trigger | What happens |
|--------|----------------|
| Push to `main` / `master` | Builds image and pushes `…/url-monitoring:<first-5-of-sha>` (no `:latest`) |
| Pull request | Builds only (validates `Dockerfile`; no push, no Docker Hub login needed on forks) |
| **Actions → Run workflow** | Same as push (manual build + push) |

**Repository secrets:** `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` (Docker Hub [access token](https://hub.docker.com/settings/security)).
