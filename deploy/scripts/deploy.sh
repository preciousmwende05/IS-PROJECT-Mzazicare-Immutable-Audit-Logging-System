#!/usr/bin/env bash
# Deploy (or update) MzaziCare on the server.
#
#   cd /opt/mzazicare/deploy && bash scripts/deploy.sh
#
# Pulls the latest code, rebuilds the API image, restarts what changed, and
# waits until the API answers its health check through HTTPS.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "deploy/.env is missing: cp .env.example .env and fill it in"; exit 1; }
if grep -q "CHANGE_ME" .env; then
  echo "deploy/.env still contains CHANGE_ME values:"; grep -n "CHANGE_ME" .env | cut -d= -f1; exit 1
fi
set -a; . ./.env; set +a

echo "==> Latest code"
git -C .. pull --ff-only

echo "==> Build and start"
docker compose -f docker-compose.prod.yml up -d --build --remove-orphans

echo "==> Waiting for https://$API_DOMAIN$API_PREFIX/health"
for i in $(seq 1 60); do
  if curl -fsS "https://$API_DOMAIN$API_PREFIX/health" >/dev/null 2>&1; then
    echo "API is live: https://$API_DOMAIN$API_PREFIX/health"
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 5
done

echo "API did not become healthy. Recent logs:"
docker compose -f docker-compose.prod.yml logs --tail 60 api caddy
exit 1
