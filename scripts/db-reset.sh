#!/usr/bin/env bash
# ============================================================================
# 重置 tmp 类库：DROP → CREATE → 授权 → 跑迁移
#
# 用法：
#   bash scripts/db-reset.sh [--db <库名>] [--yes] [--force]
#
#     --db <库名>   目标库，默认 template_tmp
#     --yes         跳过确认（无人值守 / CI）
#     --force       允许对非 *_tmp 库执行（**危险**，正常流程用不到）
#
# 环境变量：
#   MYSQL_ROOT_PASSWORD   MySQL root 密码（默认走 docker exec mysql）
#   MYSQL_ADMIN          覆盖管理连接命令，如：
#                          MYSQL_ADMIN="mysql -uroot -pXXX --default-character-set=utf8mb4"
#
# 为什么存在这个脚本：
#   建库那段 `docker exec mysql mysql -uroot -p... -e "CREATE DATABASE ... utf8mb4_unicode_ci"`
#   以前在 docs/本地环境.md 和 docs/部署端环境.md 各抄了一遍，字符集还抄错过。
#   现在只有这一处实现，库名/账号/授权的定义在 server/sql/databases.sql。
#
# 安全性：
#   - 默认只敢删 `*_tmp`；删别的库要显式 --force
#   - 默认要求手输库名确认（--yes 跳过）
#   - 账号密码从 server/.env.test 读，和进程实际用的保持一致，不在这里另存一份
# ============================================================================
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DB="template_tmp"
YES=0
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --db)    DB="${2:-}"; shift 2 ;;
    --yes)   YES=1; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) sed -n '/^# 用法：/,/^# ===.*$/p' "$0" | sed 's/^# \{0,1\}//' | head -30; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 1 ;;
  esac
done

[ -n "$DB" ] || { echo "✗ 库名不能为空" >&2; exit 1; }

# --- 闸门 1：只删 tmp 类库 ------------------------------------------------
case "$DB" in
  *_tmp) ;;
  *)
    if [ "$FORCE" -ne 1 ]; then
      echo "✗ 拒绝执行：'$DB' 不是 tmp 类库（应为 <项目>_tmp）。" >&2
      echo "  这是防手滑：本脚本会 DROP DATABASE。" >&2
      echo "  确实要重建它，加 --force，并确认它没有数据。" >&2
      exit 1
    fi
    echo "⚠ --force：即将重建非 tmp 库 '$DB'"
    ;;
esac

ENV_FILE="server/.env.test"
[ -f "$ENV_FILE" ] || { echo "✗ 找不到 $ENV_FILE" >&2; exit 1; }

# 账号密码与库名：从 .env.test 取，保证「脚本建的账号 == 进程用的账号」
APP_USER="$(grep -E '^DB_USERNAME=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
APP_PASS="$(grep -E '^DB_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
DB_IN_ENV="$(grep -E '^DB_DATABASE=' "$ENV_FILE" | head -1 | cut -d= -f2-)"

[ -n "$APP_USER" ] || { echo "✗ $ENV_FILE 里没有 DB_USERNAME" >&2; exit 1; }
[ -n "$APP_PASS" ] || { echo "✗ $ENV_FILE 里没有 DB_PASSWORD" >&2; exit 1; }

if [ "$DB_IN_ENV" != "$DB" ]; then
  echo "⚠ $ENV_FILE 的 DB_DATABASE=$DB_IN_ENV，但本次重置 '$DB'"
  echo "  重置完 e2e 仍连 $DB_IN_ENV —— 两者不一致时请确认这是你想要的。"
fi

# --- 闸门 2：确认 ---------------------------------------------------------
echo "============================================================"
echo " 即将 DROP 并重建库：$DB"
echo " 授权给账号：$APP_USER@%"
echo " 之后跑迁移（NODE_ENV=test），表结构会重建、**库内数据全部丢失**"
echo "============================================================"
if [ "$YES" -ne 1 ]; then
  printf '继续请输入库名（%s）：' "$DB"
  read -r ANSWER
  [ "$ANSWER" = "$DB" ] || { echo "✗ 输入不匹配，已取消（什么都没做）"; exit 1; }
fi

# --- 管理连接 -------------------------------------------------------------
if [ -n "${MYSQL_ADMIN:-}" ]; then
  # shellcheck disable=SC2206
  ADMIN=( $MYSQL_ADMIN )
elif [ -n "${MYSQL_ROOT_PASSWORD:-}" ]; then
  ADMIN=( mysql -h127.0.0.1 -P3306 -uroot "-p${MYSQL_ROOT_PASSWORD}" --default-character-set=utf8mb4 )
else
  # MySQL 跑在 docker 里：按镜像自动找容器（同机可能有多套，容器名不一定叫 mysql）
  CNAME="$(docker ps --format '{{.Names}}\t{{.Image}}' | awk '$2 ~ /^mysql:/ {print $1; exit}')"
  [ -n "$CNAME" ] || { echo "✗ 没找到运行中的 mysql 容器；设置 MYSQL_ADMIN 或 MYSQL_ROOT_PASSWORD" >&2; exit 1; }
  # 坑：宿主上 `docker exec c mysql -uroot -p<pw>` 会 Access denied，
  # 必须让容器内的 sh 展开 $MYSQL_ROOT_PASSWORD。
  ADMIN=( docker exec -i "$CNAME" sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --default-character-set=utf8mb4 "$@"' sh )
  echo "· 使用容器 $CNAME（未设 MYSQL_ADMIN / MYSQL_ROOT_PASSWORD）"
fi

run_admin() {
  "${ADMIN[@]}" "$@"
}

echo
echo "==> 1/4 DROP DATABASE $DB"
run_admin -e "DROP DATABASE IF EXISTS \`$DB\`;"

echo "==> 2/4 CREATE DATABASE $DB（utf8mb4_unicode_ci）"
run_admin -e "CREATE DATABASE \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

echo "==> 3/4 账号与授权（$APP_USER 只授 $DB.\*）"
run_admin -e "
CREATE USER IF NOT EXISTS '$APP_USER'@'%' IDENTIFIED BY '$APP_PASS';
ALTER USER '$APP_USER'@'%' IDENTIFIED BY '$APP_PASS';
GRANT ALL PRIVILEGES ON \`$DB\`.* TO '$APP_USER'@'%';
FLUSH PRIVILEGES;"

echo "==> 4/4 跑迁移（含 CreateCoreSchema 基线建表）"
( cd server && NODE_ENV=test pnpm migration:run )

echo
echo "✓ 库 $DB 已重建并跑完迁移"
echo "  下一步：bash scripts/verify.sh，或 NODE_ENV=test pnpm test:e2e"
