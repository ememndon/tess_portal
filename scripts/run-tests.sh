#!/usr/bin/env bash
# Runs the web test suite. The isolation tests need a scratch database
# inside the tessportal-db container; this script creates a fresh one,
# runs vitest against it, then drops it.
set -euo pipefail

cd "$(dirname "$0")/.."

source .env

DB_IP=$(docker inspect tessportal-db --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
if [[ -z "$DB_IP" ]]; then
  echo "tessportal-db is not running" >&2
  exit 1
fi

TEST_DB="tessportal_test_$RANDOM"
docker exec tessportal-db psql -U "$POSTGRES_USER" -d postgres -q -c "CREATE DATABASE $TEST_DB;"
trap 'docker exec tessportal-db psql -U "$POSTGRES_USER" -d postgres -q -c "DROP DATABASE IF EXISTS $TEST_DB WITH (FORCE);"' EXIT

REDIS_IP=$(docker inspect tessportal-redis --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
export TEST_DATABASE_URL="postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@$DB_IP:5432/$TEST_DB"
export TEST_REDIS_URL="redis://:$REDIS_PASSWORD@$REDIS_IP:6379/15"

echo "=== web tests ==="
npx vitest run --root apps/web "$@"

echo "=== worker tests ==="
npx vitest run --root apps/worker "$@"
