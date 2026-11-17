#!/usr/bin/env bash
# Template 管理平台 - MySQL 备份脚本（模板，未启用）
# 用法（建议 cron，每日凌晨）：0 2 * * * /path/deploy/backup.sh
# 说明：全量 mysqldump + 保留 N 天；异地拷贝用 restic/rclone（待部署端确认后再接）
set -euo pipefail

: "${DB_HOST:=127.0.0.1}"
: "${DB_PORT:=3306}"
: "${DB_USER:=template}"
: "${DB_PASSWORD:?DB_PASSWORD 未设置}"
: "${DB_NAME:=template}"

BACKUP_DIR="${BACKUP_DIR:-/data/backups/template}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="${BACKUP_DIR}/${DB_NAME}-${STAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[backup] dump ${DB_NAME} -> ${FILE}"
mysqldump \
  --host="$DB_HOST" --port="$DB_PORT" \
  --user="$DB_USER" --password="$DB_PASSWORD" \
  --single-transaction --quick --routines --events --triggers \
  --default-character-set=utf8mb4 \
  "$DB_NAME" | gzip -9 > "$FILE"

echo "[backup] 清理 ${KEEP_DAYS} 天前备份"
find "$BACKUP_DIR" -name "${DB_NAME}-*.sql.gz" -mtime "+${KEEP_DAYS}" -delete

echo "[backup] done: $(du -h "$FILE" | cut -f1)"
# TODO: 异地备份（restic backup / rclone copy）
# TODO: 恢复演练脚本（定期从备份恢复并校验）
