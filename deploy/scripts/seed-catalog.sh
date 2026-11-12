#!/usr/bin/env bash
# Publish the starting care services so families can request visits.
#
#   bash scripts/seed-catalog.sh +254712345678
#
# Uses an existing ADMIN account (see make-admin.sh). The password is asked
# for and never stored or echoed.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

PHONE="${1:?Usage: bash scripts/seed-catalog.sh +2547XXXXXXXX}"
read -rsp "Password for $PHONE: " PASSWORD; echo

docker run --rm \
  -e API_URL="https://$API_DOMAIN$API_PREFIX" \
  -e ADMIN_PHONE="$PHONE" \
  -e ADMIN_PASSWORD="$PASSWORD" \
  -v "$PWD/scripts/seed-catalog.mjs:/seed.mjs:ro" \
  node:22-alpine node /seed.mjs
