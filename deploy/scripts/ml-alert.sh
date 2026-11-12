#!/usr/bin/env bash
# Hourly: score the last 2 hours of real activity with the trained anomaly
# model. Every window it flags becomes an alert; the API notifies all admins
# and auditors within ~2 minutes. Run by cron (see deploy/crontab.txt).
#
# Needs the trained run folder on the server:
#   ml/audit-anomaly/runs/$ML_RUN/   (copy it with scp; runs/ is not in git)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

RUN_DIR=../ml/audit-anomaly/runs/$ML_RUN
[ -d "$RUN_DIR" ] || { echo "Model run $RUN_DIR not found: copy it to the server (see deploy/README.md)"; exit 1; }

cd ../ml/audit-anomaly
../.venv/bin/python src/live.py --uri "$MONGODB_URI" alert --run "$ML_RUN" --hours 2
