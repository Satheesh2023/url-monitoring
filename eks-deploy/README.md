# EKS deployment (Docker Hub + Aurora MySQL)

Manifests for running the **url-monitoring** image on EKS behind an **AWS ALB**, with **Amazon Aurora MySQL** as the database (no in-cluster MySQL).

Default image in these manifests: **`satheesh2023/url-monitoring:e6cf1`** (change `images.newTag` in `kustomization.yaml` when you publish a new tag).

**Slack channel:** Most org webhooks post only to the channel picked when the webhook was created — you do not set the channel in Kubernetes. Optionally set **`SLACK_CHANNEL`** in `secret-app.yaml` (e.g. `#uptime-alerts`) if your Slack setup allows [channel override](https://api.slack.com/messaging/webhooks); otherwise leave it empty or omit the key.

## Prerequisites

- EKS cluster with [AWS Load Balancer Controller](https://kubernetes-sigs.github.io/aws-load-balancer-controller/) installed.
- An `IngressClass` named **`alb`** (default in many EKS guides). If yours differs, edit `ingress.yaml` (`spec.ingressClassName`).
- Aurora reachable from pod subnets; security group allows **3306** from nodes/pods.
- ACM certificate in the same region (for HTTPS) if you use `certificate-arn`.

## 1. Edit placeholders

| File | What to change |
|------|----------------|
| `kustomization.yaml` | `images.newTag` when you push a new tag (e.g. next short SHA). |
| `ingress.yaml` | `alb.ingress.kubernetes.io/certificate-arn`, `host` under `rules`, optional `group.name` to share one ALB. |
| `secret-app.yaml.example` | Copy to `secret-app.yaml` (do not commit real secrets), set `DATABASE_URL` (Aurora) and optional `SLACK_WEBHOOK_URL`. |

`DATABASE_URL` example:

`mysql://USER:PASSWORD@your-aurora-cluster.cluster-xxxxx.us-east-1.rds.amazonaws.com:3306/yourdbname`

## 2. Apply

```bash
cd eks-deploy
cp secret-app.yaml.example secret-app.yaml
# edit secret-app.yaml and kustomization.yaml / ingress.yaml

kubectl apply -f secret-app.yaml
kubectl apply -k .
```

## 3. DNS

After the Ingress is ready:

```bash
kubectl get ingress -n url-monitoring
```

Point your DNS **CNAME** (or Alias **A/ALIAS** for Route 53) to the **ALB hostname** shown in the Ingress status.

## 4. Notes

- The container image runs **`prisma migrate deploy`** on startup, then the server (see `Dockerfile` `CMD`). Ensure Aurora credentials and network allow this on first boot.
- Health checks use **`/api/health`** (matches app probes and ALB health check).
- Weekly report CronJob uses the same image and `DATABASE_URL`; schedule is **UTC** (`0 9 * * 1` = Monday 09:00 UTC).

## HTTP-only (no ACM yet)

For a quick test, strip these annotations from `ingress.yaml`: `listen-ports`, `ssl-redirect`, `certificate-arn`. Use a single listener, e.g. `alb.ingress.kubernetes.io/listen-ports: '[{"HTTP": 80}]'`.

## Secrets and git

`secret-app.yaml` (copied from the example) is listed in the repo `.gitignore` so it is not committed by mistake.
