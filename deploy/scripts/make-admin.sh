#!/usr/bin/env bash
# Make an existing, verified account an administrator. Nobody can register as
# admin through the app (by design), so the FIRST admin is created here; after
# that, admins change roles on the Users page.
#
#   bash scripts/make-admin.sh +254712345678
#
# Register and verify that phone in the app first.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

PHONE="${1:?Usage: bash scripts/make-admin.sh +2547XXXXXXXX}"
[[ "$PHONE" =~ ^\+254[0-9]{9}$ ]] || { echo "Use the +254 format, e.g. +254712345678"; exit 1; }

docker run --rm mongo:7 mongosh "$MONGODB_URI" --quiet --eval "
  const r = db.users.updateOne({ phone: '$PHONE', status: 'active' }, { \$set: { role: 'admin', updatedAt: new Date() } });
  if (!r.matchedCount) { print('No ACTIVE account with phone $PHONE. Register and verify it in the app first.'); quit(1); }
  print('$PHONE is now an admin. Sign out and back in to use admin pages.');
"
