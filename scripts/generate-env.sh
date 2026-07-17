#!/usr/bin/env bash
# Generates /opt/tessportal/.env with fresh secrets. Refuses to overwrite
# an existing .env so a regenerated key can never silently orphan the
# vault or the database.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  echo ".env already exists. Remove it deliberately if you really want new secrets." >&2
  exit 1
fi

PG_PASSWORD="$(openssl rand -hex 24)"
REDIS_PASSWORD="$(openssl rand -hex 24)"
MEILI_MASTER_KEY="$(openssl rand -hex 24)"
VAULT_MASTER_KEY="$(openssl rand -hex 32)"
SESSION_SECRET="$(openssl rand -hex 32)"

umask 177
cat > .env <<EOF
NODE_ENV=production
APP_URL=https://career.tessconsole.cloud
LOG_LEVEL=info

POSTGRES_USER=tessportal
POSTGRES_PASSWORD=${PG_PASSWORD}
POSTGRES_DB=tessportal
DATABASE_URL=postgres://tessportal:${PG_PASSWORD}@tessportal-db:5432/tessportal

REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_URL=redis://:${REDIS_PASSWORD}@tessportal-redis:6379/0

MEILI_MASTER_KEY=${MEILI_MASTER_KEY}
MEILI_HOST=http://tessportal-search:7700

VAULT_MASTER_KEY=${VAULT_MASTER_KEY}

SESSION_SECRET=${SESSION_SECRET}

WORKER_HEALTH_PORT=3001
EOF

echo ".env generated with fresh secrets, permissions 600."
echo "Back up VAULT_MASTER_KEY somewhere safe. Without it, vault records are unreadable."
