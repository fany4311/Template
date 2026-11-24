#!/usr/bin/env bash
# 用法：
#   bash deploy/restore.sh <备份文件.sql.gz> [--db 目标库] [--yes] [--dry-run]
#
# 说明：
#   - 默认恢复到 <原库>_restore_<时间戳>，**绝不覆盖生产库**（--db 指生产库会被拒绝）
#   - 先 gzip -t，再比对同名 .sha256（backup.sh 生成），最后才导入
#   - 需要本机有 mysql 客户端（部署端环境，见 docs/部署端环境.md）
# ============
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FILE=""
TARGET=""
YES=0
DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --db)      TARGET="${2:-}"; shift 2 ;;
    --yes)     YES=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '/^# 用法：/,/^# ============/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)        echo "未知参数：$1" >&2; exit 1 ;;
    *)         FILE="$1"; shift ;;
  esac
done

[ -n "$FILE" ] || { echo "用法：bash deploy/restore.sh <备份文件.sql.gz> [--db 目标库] [--yes] [--dry-run]" >&2; exit 1; }
[ -f "$FILE" ] || { echo "✗ 文件不存在：$FILE" >&2; exit 1; }

# 连接信息：环境变量优先，其次 server/.env.prod
if [ -z "${DB_NAME:-}" ] && [ -f server/.env.prod ]; then
  set -a; . server/.env.prod; set +a
fi
: "${DB_HOST:=127.0.0.1}"
: "${DB_PORT:=3306}"
# 账号：一库一账号（见 server/sql/databases.sql）。
# 既要认 DB_USER（命令行/环境变量），也要认 .env.prod 里的 DB_USERNAME ——
# 上面 source 进来的是 DB_USERNAME，只写 DB_USER 默认值会静默退回旧共享账号。
DB_USER="${DB_USER:-${DB_USERNAME:-}}"
: "${DB_USER:?缺 DB_USER / DB_USERNAME（环境变量或 server/.env.prod）}"
: "${DB_NAME:?缺 DB_NAME（环境变量或 server/.env.prod）}"
: "${DB_PASSWORD:?缺 DB_PASSWORD}"

TARGET="${TARGET:-${DB_NAME}_restore_$(date +%Y%m%d%H%M%S)}"
[[ "$TARGET" =~ ^[a-zA-Z0-9_]+$ ]] || { echo "✗ 目标库名只允许字母数字下划线：$TARGET" >&2; exit 1; }
[ "$TARGET" != "$DB_NAME" ] || { echo "✗ 拒绝恢复到生产库 $DB_NAME；演练请用 --db 指定其它库" >&2; exit 1; }

echo "==> 校验备份"
gzip -t "$FILE" || { echo "✗ gzip 校验失败：文件损坏" >&2; exit 1; }
if [ -f "$FILE.sha256" ]; then
  ( cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256" >/dev/null ) \
    || { echo "✗ sha256 不匹配：文件可能被改过/拷坏" >&2; exit 1; }
  echo "    gzip + sha256 均通过"
else
  echo "    ⚠ 没有 .sha256 旁文件，只做了 gzip 完整性检查"
fi

echo "==> 计划：$FILE  →  库 $TARGET（$DB_HOST:$DB_PORT）"
if [ "$DRY" -eq 1 ]; then
  echo "（dry-run，未执行导入）"
  exit 0
fi

if [ "$YES" -eq 0 ]; then
  read -r -p "确认恢复到 $TARGET ？[y/N] " ans
  case "$ans" in
    y|Y) ;;
    *) echo "已取消"; exit 1 ;;
  esac
fi

MYSQL=(mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASSWORD")

# 建库/授权需要管理员连接：一库一账号后，业务账号（如 template_prod）只有
# `<本库>.*` 权限，**建不了新库**，演练目标库必须用管理员建。
# 与 scripts/db-reset.sh 同一套接口：MYSQL_ADMIN / MYSQL_ROOT_PASSWORD。
if [ -n "${MYSQL_ADMIN:-}" ]; then
  # shellcheck disable=SC2206
  ADMIN=( $MYSQL_ADMIN )
elif [ -n "${MYSQL_ROOT_PASSWORD:-}" ]; then
  ADMIN=( mysql -h"$DB_HOST" -P"$DB_PORT" -uroot "-p${MYSQL_ROOT_PASSWORD}" --default-character-set=utf8mb4 )
else
  # 退回到业务账号：只在旧的「一账号多库」授权下能跑通，新模型下会 Permission denied
  ADMIN=( "${MYSQL[@]}" )
  echo "⚠ 未设 MYSQL_ADMIN / MYSQL_ROOT_PASSWORD，试用业务账号建库（一库一账号下会失败）"
fi

echo "==> 建库（若不存在）"
"${ADMIN[@]}" -e "CREATE DATABASE IF NOT EXISTS $TARGET CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" || {
  echo "✗ 建库失败。演练目标库需管理员建：" >&2
  echo "    MYSQL_ROOT_PASSWORD=<root密码> bash deploy/restore.sh $FILE --db <目标库>" >&2
  exit 1
}

echo "==> 导入"
gunzip -c "$FILE" | "${MYSQL[@]}" "$TARGET"

TABLE_COUNT="$("${MYSQL[@]}" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$TARGET'")"
echo "==> 完成：$TARGET 共 $TABLE_COUNT 张表"
echo "    抽查：${MYSQL[*]} -e 'SELECT COUNT(*) FROM sys_user' $TARGET"
echo "    演练完删除：${MYSQL[*]} -e 'DROP DATABASE $TARGET'"
