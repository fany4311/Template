#!/usr/bin/env bash
# Template 管理平台 - MySQL 备份脚本（模板，未启用）
# 用法（建议 cron，每日凌晨）：0 2 * * * /path/deploy/backup.sh
# 说明：全量 mysqldump + 保留 N 天；异地拷贝用 restic/rclone（待部署端确认后再接）
set -euo pipefail

: "${DB_HOST:=127.0.0.1}"
: "${DB_PORT:=3306}"
# 一库一账号（见 server/sql/databases.sql）：只认 DB_USER / DB_USERNAME 显式传入，
# 不再默默退回旧的共享账号 'template' —— 那个默认值在 cron 里会被漏掉。
DB_USER="${DB_USER:-${DB_USERNAME:-}}"
: "${DB_USER:?必须显式指定 DB_USER（如 template_prod），不提供默认值}"
: "${DB_PASSWORD:?DB_PASSWORD 未设置}"
# 以前这里是 `${DB_NAME:=template}`，默认备份 **dev 库**。
# cron 里忘传 DB_NAME，就会得到一份"看上去正常"的备份，而生产库根本没备。
: "${DB_NAME:?必须显式指定 DB_NAME（生产用 <项目>_prod，不要依赖默认值）}"

BACKUP_DIR="${BACKUP_DIR:-/data/backups/template}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="${BACKUP_DIR}/${DB_NAME}-${STAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

# 失败时删掉半截文件：一个"看起来存在"的坏备份比没有备份更危险
trap 'rm -f "$FILE" "$FILE.sha256"' ERR

echo "[backup] dump ${DB_NAME} -> ${FILE}"
mysqldump \
  --host="$DB_HOST" --port="$DB_PORT" \
  --user="$DB_USER" --password="$DB_PASSWORD" \
  --single-transaction --quick --routines --events --triggers \
  --default-character-set=utf8mb4 \
  "$DB_NAME" | gzip -9 > "$FILE"

# 校验：gzip 能完整解压 + 记 sha256（restore.sh 会先比对，防拷坏）
gzip -t "$FILE"
SHA="$(sha256sum "$FILE" | cut -d' ' -f1)"
printf '%s  %s\n' "$SHA" "$(basename "$FILE")" > "$FILE.sha256"
echo "[backup] verified gzip, sha256=${SHA:0:12}"

echo "[backup] 清理 ${KEEP_DAYS} 天前备份"
find "$BACKUP_DIR" -name "${DB_NAME}-*.sql.gz" -mtime "+${KEEP_DAYS}" -delete

echo "[backup] done: $(du -h "$FILE" | cut -f1)"
# 恢复：bash deploy/restore.sh <备份文件>（默认恢复到 <库>_restore_<时间戳>，不覆盖生产）
# 异地备份（restic/rclone）由部署端按环境决定，脚本不内置。
