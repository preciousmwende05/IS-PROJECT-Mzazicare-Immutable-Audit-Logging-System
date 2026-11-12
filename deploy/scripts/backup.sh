#!/usr/bin/env bash
# Nightly backup: the whole MongoDB database (including the audit chain) and
# the uploaded files. Run by cron (see deploy/crontab.txt).
#
#   bash scripts/backup.sh
#
# Writes to /opt/mzazicare/backups and keeps BACKUP_KEEP_DAYS days.
# A backup on the same server does not survive losing the server: copy the
# backups off it too (see "Off-server copies" in deploy/README.md).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

DEST=/opt/mzazicare/backups
STAMP=$(date +%Y-%m-%d_%H%M)
mkdir -p "$DEST"

echo "==> MongoDB → $DEST/mongo_$STAMP.archive.gz"
docker run --rm mongo:7 mongodump --uri="$MONGODB_URI" --archive --gzip > "$DEST/mongo_$STAMP.archive.gz"

echo "==> Uploaded files → $DEST/files_$STAMP.tar.gz"
docker run --rm -v mzazicare_rustfs-data:/data:ro -v "$DEST":/backup alpine \
  tar czf "/backup/files_$STAMP.tar.gz" -C /data .

echo "==> Removing backups older than ${BACKUP_KEEP_DAYS:-14} days"
find "$DEST" -type f -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete

ls -lh "$DEST" | tail -4
echo "Restore the database with:"
echo "  docker run --rm -i mongo:7 mongorestore --uri=\"\$MONGODB_URI\" --archive --gzip --drop < $DEST/mongo_$STAMP.archive.gz"
