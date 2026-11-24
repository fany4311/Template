#!/usr/bin/env bash
# ============================================================================
# 应用库/账号定义：把 server/sql/databases.sql 渲染后交给 MySQL 执行
#
# 用法：
#   bash scripts/db-apply.sh [--dry-run]
#
# 为什么要这个脚本：
#   真实密码**不能写进 databases.sql** —— 那个文件随 SVN 分发给派生项目，
#   写进去等于把本机密码发给所有副本，而且 git 历史里擦不掉。
#   所以：SQL 里只留 <改我-dev|prod|tmp> 占位符，真密码只存在（已 gitignore 的）
#   .env.dev / .env.test / .env.prod 里，由本脚本在**临时文件**里渲染后执行。
#
# 管理员连接（与 db-reset.sh 同一套接口）：
#   MYSQL_ADMIN         完整命令，如 "mysql -uroot -pXXX"
#   MYSQL_ROOT_PASSWORD 有 mysql 客户端时用它连 127.0.0.1
#   都不给则自动找运行 mysql 镜像的容器，docker exec 进去
# ============================================================================
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

SQL_FILE="server/sql/databases.sql"
[ -f "$SQL_FILE" ] || { echo "✗ 找不到 $SQL_FILE" >&2; exit 1; }

read_pw() {
  local f="$1"
  [ -f "$f" ] || { echo "✗ 缺 $f（真实密码只从 .env 读）" >&2; exit 1; }
  local pw
  pw="$(grep -E '^DB_PASSWORD=' "$f" | head -1 | cut -d= -f2-)"
  [ -n "$pw" ] || { echo "✗ $f 的 DB_PASSWORD 为空" >&2; exit 1; }
  printf '%s' "$pw"
}

P_DEV="$(read_pw server/.env.dev)"
P_PROD="$(read_pw server/.env.prod)"
P_TMP="$(read_pw server/.env.test)"

if [ "$P_DEV" = "$P_PROD" ] || [ "$P_DEV" = "$P_TMP" ] || [ "$P_PROD" = "$P_TMP" ]; then
  echo "✗ 三段密码有重复：一库一账号的意义就在于互不相同" >&2
  exit 1
fi

# --- 渲染到临时文件（0600，退出即删）---
RENDERED="$(mktemp)"
chmod 600 "$RENDERED"
trap 'rm -f "$RENDERED"' EXIT

python3 - "$SQL_FILE" "$RENDERED" "$P_DEV" "$P_PROD" "$P_TMP" <<'PY'
import sys, pathlib
src, dst = sys.argv[1], sys.argv[2]
dev, prod, tmp = sys.argv[3:6]
text = pathlib.Path(src).read_text(encoding="utf-8")
for ph, pw in (("<改我-dev>", dev), ("<改我-prod>", prod), ("<改我-tmp>", tmp)):
    if ph not in text:
        sys.exit(f"✗ SQL 里找不到占位符 {ph}（是否被手改成真实密码了？改回占位符）")
    text = text.replace(ph, pw)
pathlib.Path(dst).write_text(text, encoding="utf-8")
PY

echo "· 已用 .env 里的三段密码渲染（临时文件，不落盘到仓库）"

# --- 管理员连接 ---
if [ -n "${MYSQL_ADMIN:-}" ]; then
  # shellcheck disable=SC2206
  ADMIN=( $MYSQL_ADMIN )
elif [ -n "${MYSQL_ROOT_PASSWORD:-}" ]; then
  ADMIN=( mysql -h127.0.0.1 -P3306 -uroot "-p${MYSQL_ROOT_PASSWORD}" --default-character-set=utf8mb4 )
else
  # 同机可能有多套 MySQL 容器（本项目 / 派生项目），按镜像自动找
  CNAME="$(docker ps --format '{{.Names}}\t{{.Image}}' | awk '$2 ~ /^mysql:/ {print $1; exit}')"
  [ -n "$CNAME" ] || { echo "✗ 没找到运行中的 mysql 容器；设置 MYSQL_ADMIN 或 MYSQL_ROOT_PASSWORD" >&2; exit 1; }
  echo "· 使用容器 $CNAME（root 密码取容器内的 MYSQL_ROOT_PASSWORD）"
  # 坑：宿主上 `docker exec c mysql -uroot -p<pw>` 会 Access denied，
  # 必须让容器内的 sh 展开 $MYSQL_ROOT_PASSWORD。
  ADMIN=( docker exec -i "$CNAME" sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --default-character-set=utf8mb4 "$@"' sh )
fi

if [ "$DRY" -eq 1 ]; then
  echo "（dry-run，未执行）将执行：${ADMIN[*]} < <render>"
  grep -nE "^CREATE (DATABASE|USER)|^GRANT" "$SQL_FILE" | sed 's/IDENTIFIED BY .*/IDENTIFIED BY ****;/'
  exit 0
fi

echo "==> 执行 $SQL_FILE"
"${ADMIN[@]}" < "$RENDERED" 2>&1 | grep -v "Using a password" || true

echo "==> 复核授权（每个账号只应看到自己的库）"
"${ADMIN[@]}" -N -e "
  SHOW GRANTS FOR 'template_dev'@'%';
  SHOW GRANTS FOR 'template_prod'@'%';
  SHOW GRANTS FOR 'template_tmp'@'%';" 2>/dev/null | grep -v "USAGE ON \*\.\*" || true

echo
echo "✓ 完成。库/账号定义见 server/sql/databases.sql，台账见 docs/库台账.md"
