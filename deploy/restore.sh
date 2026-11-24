#!/usr/bin/env bash
# 用法：
#   bash deploy/restore.sh <备份文件.sql.gz> [--db 目标库] [--yes] [--dry-run] [--force]
#
# 说明：
#   - 默认恢复到 `<项目>_tmp_restore`（固定名，**每次先 DROP 再导入**）
#     旧行为是 `<原库>_restore_<时间戳>` —— 每演练一次多一个库，几轮下来库表就散了。
#     演练本是「可重建的一次性动作」，目标库就该是 tmp 类库、名字固定。
#   - 绝不覆盖生产库：目标库必须叫 *__tmp_restore / *__tmp，否则要 --force
#   - 先 gzip -t，再比对同名 .sha256（backup.sh 生成），最后才导入
#   - 建库/删库需管理员连接：MYSQL_ADMIN 或 MYSQL_ROOT_PASSWORD（一库一账号后
#     业务账号只有本库权限，建不了新库）
# ============
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FILE=""
TARGET=""
YES=0
DRY=0
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --db)      TARGET="${2:-}"; shift 2 ;;
    --yes)     YES=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --force)   FORCE=1; shift ;;
    -h|--help) sed -n '/^# 用法：/,/^# ============/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)        echo "未知参数：$1" >&2; exit 1 ;;
    *)         FILE="$1"; shift ;;
  esac
done

[ -n "$FILE" ] || { echo "用法：bash deploy/restore.sh <备份文件.sql.gz> [--db 目标库] [--yes] [--dry-run] [--force]" >&2; exit 1; }
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

# 默认目标：<项目>_tmp_restore（固定名，不随次数增长）
#   template_prod → template_tmp_restore；template → template_tmp_restore
TARGET="${TARGET:-${DB_NAME%_prod}_tmp_restore}"
[[ "$TARGET" =~ ^[a-zA-Z0-9_]+$ ]] || { echo "✗ 目标库名只允许字母数字下划线：$TARGET" >&2; exit 1; }
[ "$TARGET" != "$DB_NAME" ] || { echo "✗ 拒绝恢复到源库 $DB_NAME；演练请用 --db 指定 tmp 类库" >&2; exit 1; }
case "$TARGET" in
  *_tmp|*_tmp_restore) ;;
  *)
    [ "$FORCE" -eq 1 ] || {
      echo "✗ 拒绝执行：目标库 '$TARGET' 不是 tmp 类库（应为 <项目>_tmp_restore）。" >&2
      echo "  本脚本会先 DROP 目标库再导入 —— 只允许落在可丢弃的库上。" >&2
      echo "  确实要覆盖它，加 --force。" >&2
      exit 1
    }
    echo "⚠ --force：即将清空非 tmp 库 '$TARGET'"
    ;;
esac

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
echo "    目标库会被先 DROP：库内现有数据将丢失（演练一次性动作）"
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

# ---- 连接解析：本机 mysql 客户端优先，没有则走 docker exec ------------------
# 密码一律用 MYSQL_PWD 环境变量传，不出现在 argv / ps 里。
CNAME=""
if ! command -v mysql >/dev/null 2>&1; then
  CNAME="$(docker ps --format '{{.Names}}\t{{.Image}}' 2>/dev/null | awk '$2 ~ /^mysql:/ {print $1; exit}')"
  [ -n "$CNAME" ] || {
    echo "✗ 本机没有 mysql 客户端，也没找到运行中的 mysql 容器" >&2
    echo "  装上客户端：apt install mysql-client，或先 docker compose up -d" >&2
    exit 1
  }
  echo "· 本机无 mysql 客户端，改用容器 $CNAME"
fi

# 业务连接（导入用）：一库一账号下的 DB_USER
if [ -n "$CNAME" ]; then
  MYSQL=( docker exec -i -e MYSQL_PWD="$DB_PASSWORD" "$CNAME"
          mysql -u"$DB_USER" --default-character-set=utf8mb4 )
else
  MYSQL=( mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" --default-character-set=utf8mb4 )
  export MYSQL_PWD="$DB_PASSWORD"
fi

# 管理员连接（DROP / CREATE / GRANT 用）
#  1) MYSQL_ADMIN：完整命令前缀，**不要带引号**，密码内联
#  2) MYSQL_ROOT_PASSWORD（本机客户端）
#  3) 容器：从容器内的 MYSQL_ROOT_PASSWORD 取 root 密码
if [ -n "${MYSQL_ADMIN:-}" ]; then
  # shellcheck disable=SC2206
  ADMIN=( $MYSQL_ADMIN )
elif [ -z "$CNAME" ]; then
  [ -n "${MYSQL_ROOT_PASSWORD:-}" ] || { echo "✗ 缺 MYSQL_ROOT_PASSWORD（建库要管理员）" >&2; exit 1; }
  ADMIN=( mysql -h"$DB_HOST" -P"$DB_PORT" -uroot --default-character-set=utf8mb4 )
  # root 与业务账号密码不同，单独开一个子环境（不改全局 MYSQL_PWD）
  ADMIN=( env MYSQL_PWD="$MYSQL_ROOT_PASSWORD" "${ADMIN[@]}" )
else
  ROOTPW="$(docker inspect "$CNAME" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | sed -n 's/^MYSQL_ROOT_PASSWORD=//p')"
  [ -n "$ROOTPW" ] || { echo "✗ 取不到容器 $CNAME 的 MYSQL_ROOT_PASSWORD；改用 MYSQL_ADMIN" >&2; exit 1; }
  ADMIN=( docker exec -i -e MYSQL_PWD="$ROOTPW" "$CNAME" mysql -uroot --default-character-set=utf8mb4 )
fi

echo "==> 清空、重建并授权 $TARGET（DROP → CREATE → GRANT）"
# 三件事必须一起做：
#  1) 先 DROP：固定名目标库，上次演练习的表会让本次导入报 already exists
#  2) CREATE：字符集与迁移一致
#  3) GRANT 给 DB_USER：一库一账号后，业务账号只有源库权限，
#     不授权的话紧接着的导入（用业务账号跑）会 Permission denied
"${ADMIN[@]}" -e "
DROP DATABASE IF EXISTS \`$TARGET\`;
CREATE DATABASE \`$TARGET\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON \`$TARGET\`.* TO '$DB_USER'@'%';
FLUSH PRIVILEGES;" || {
  echo "✗ 清空/建库/授权失败：需要一个能做 DROP/CREATE/GRANT 的管理员连接。" >&2
  echo "  二选一：" >&2
  echo "    MYSQL_ROOT_PASSWORD=<root密码> bash deploy/restore.sh $FILE --yes   # 本机有 mysql 客户端时" >&2
  echo "    MYSQL_ADMIN='docker exec -i <mysql容器> mysql -uroot -pXXX --default-character-set=utf8mb4' bash deploy/restore.sh $FILE --yes" >&2
  exit 1
}

echo "==> 导入"
# 必须剥掉 dump 里的 `CREATE DATABASE` / `USE` 语句：
# `mysqldump --databases`（以及不少手工备份）会把源库名写进 SQL 流，
# 原样灌进去会**写回源库而不是目标库** —— 演练看着成功，实际一行没进目标库，
# 更坏的情况是把生产库原地覆盖一遍。目标库只由命令行参数决定。
gunzip -c "$FILE" \
  | grep -v -E "^CREATE DATABASE |^USE " \
  | "${MYSQL[@]}" "$TARGET"

TABLE_COUNT="$("${MYSQL[@]}" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$TARGET'")"
echo "==> 完成：$TARGET 共 $TABLE_COUNT 张表"
echo "    抽查：${MYSQL[*]} -e 'SELECT COUNT(*) FROM sys_user' $TARGET"
echo "    演练完删除：${MYSQL[*]} -e 'DROP DATABASE $TARGET'"
