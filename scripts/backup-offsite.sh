#!/usr/bin/env bash
# Stage 2 of the Tess Portal offsite backup: take the newest local dump,
# gpg-encrypt it with AES256 on the HOST, and rclone-copy the ciphertext
# to Google Drive. Google only ever receives encrypted bytes.
#
# Self-contained under /opt/tessportal: its own rclone remote
# (portaldrive), its own gpg passphrase (BACKUP_GPG_PASSPHRASE in .env),
# its own Drive folder (TessPortalBackups). Runs as emison from cron,
# right after backup-dump.sh. Safe to run before rclone is configured: it
# exits 0 if .rclone.conf is absent.
set -uo pipefail

ROOT="/opt/tessportal"
BACKUP_DIR="$ROOT/backups"
LOG="$ROOT/logs/backup.log"
RCLONE_CONF="$ROOT/.rclone.conf"
REMOTE="${BACKUP_REMOTE:-portaldrive}"
DIR="${BACKUP_DRIVE_DIR:-TessPortalBackups}"
KEEP_REMOTE=30

umask 077

log() { printf '%s [offsite] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >>"$LOG"; }

# not configured yet: no-op cleanly so cron never errors before setup
if [[ ! -f "$RCLONE_CONF" ]]; then
  log "skipped: $RCLONE_CONF not present yet (run rclone config to enable Drive uploads)"
  exit 0
fi

# shellcheck disable=SC1091
if ! . "$ROOT/.env" 2>/dev/null; then
  log "FAILED: cannot read $ROOT/.env"
  exit 1
fi
if [[ -z "${BACKUP_GPG_PASSPHRASE:-}" ]]; then
  log "FAILED: BACKUP_GPG_PASSPHRASE is not set in .env"
  exit 1
fi

LATEST="$(ls -1t "$BACKUP_DIR"/portal_*.sql.gz 2>/dev/null | head -n1 || true)"
if [[ -z "$LATEST" ]]; then
  log "FAILED: no local dump to upload (run backup-dump.sh first)"
  exit 1
fi

ENC="/tmp/$(basename "$LATEST").gpg"
cleanup() { rm -f "$ENC"; }
trap cleanup EXIT

# encrypt before it ever leaves the box
if ! gpg --batch --yes --passphrase "$BACKUP_GPG_PASSPHRASE" \
      -c --cipher-algo AES256 -o "$ENC" "$LATEST" 2>>"$LOG"; then
  log "FAILED: gpg encryption of $(basename "$LATEST")"
  exit 1
fi

# upload the ciphertext
if ! rclone copy "$ENC" "$REMOTE:$DIR/" --config "$RCLONE_CONF" --drive-use-trash=false 2>>"$LOG"; then
  log "FAILED: rclone upload to $REMOTE:$DIR/"
  exit 1
fi
log "OK uploaded $(basename "$ENC") to $REMOTE:$DIR/"

# prune the Drive folder to the newest $KEEP_REMOTE (names are date-sorted)
mapfile -t REMOTE_OLD < <(rclone lsf "$REMOTE:$DIR/" --config "$RCLONE_CONF" 2>>"$LOG" | sort | head -n "-$KEEP_REMOTE")
for f in "${REMOTE_OLD[@]:-}"; do
  [[ -z "$f" ]] && continue
  if rclone delete "$REMOTE:$DIR/$f" --config "$RCLONE_CONF" --drive-use-trash=false 2>>"$LOG"; then
    log "pruned remote $f"
  fi
done

exit 0
