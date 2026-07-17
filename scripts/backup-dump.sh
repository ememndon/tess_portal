#!/usr/bin/env bash
# Stage 1 of the Tess Portal offsite backup: a local, gzip-compressed
# pg_dump of the portal database, taken on the HOST via docker exec into
# the portal's own DB container. Fully self-contained under
# /opt/tessportal; touches nothing belonging to any other project.
#
# Runs as the emison user from cron. Stage 2 (backup-offsite.sh) encrypts
# the newest dump and ships it to Google Drive.
set -uo pipefail

ROOT="/opt/tessportal"
DB_CONTAINER="tessportal-db"
BACKUP_DIR="$ROOT/backups"
LOG="$ROOT/logs/backup.log"
KEEP=14

umask 077

log() { printf '%s [dump] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >>"$LOG"; }

# portal's own credentials, never another project's
# shellcheck disable=SC1091
if ! . "$ROOT/.env" 2>/dev/null; then
  log "FAILED: cannot read $ROOT/.env"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

OUT="$BACKUP_DIR/portal_$(date -u +%F_%H%M).sql.gz"

# pg_dump inside the container, streamed out through gzip on the host so
# the plaintext dump is never written to disk in the clear
if docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-}" "$DB_CONTAINER" \
      pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" 2>>"$LOG" | gzip >"$OUT"; then
  chmod 600 "$OUT"
  SIZE=$(du -h "$OUT" | cut -f1)
  log "OK wrote $(basename "$OUT") ($SIZE)"
else
  rm -f "$OUT"
  log "FAILED: pg_dump/gzip returned non-zero, no dump written"
  exit 1
fi

# retention: keep only the newest $KEEP local dumps
mapfile -t OLD < <(ls -1t "$BACKUP_DIR"/portal_*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)))
if ((${#OLD[@]})); then
  rm -f "${OLD[@]}"
  log "pruned ${#OLD[@]} old local dump(s), keeping newest $KEEP"
fi

exit 0
