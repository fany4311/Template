#!/usr/bin/env bash
# 用法：
#   bash deploy/rename.sh <slug> [--brand "显示名"] [--ports api,admin,web[,prod_admin,prod_web]]
#                                [--env] [--yes]
#
# 作用：
#   把本仓库从底座身份（template / Template 管理平台）整体改成新项目身份：
#   npm 包名、APP_NAME、DB 名、bucket、token key、PM2 进程名、Nginx 站点名、
#   产物/日志/备份路径、脚本与 conf 文件名、页面标题与文档。
#
# 不做（脚本管不了的，见 docs/init.md）：
#   建库与授权、Redis 索引、bucket 权限、首个超管、端口在机器上的实际占用。
#
# 参数：
#   <slug>       新项目标识，^[a-z][a-z0-9]{1,23}$（小写字母开头，不含点/下划线）
#   --brand      显示名，默认 = slug 首字母大写；已以「平台/系统」结尾时不再追加「管理平台」
#   --ports      dev 三端口 api,admin,web；可选再加 prod 两端口（Nginx 站点监听）
#   --env        同时改 server/.env.dev|.env.test|.env.prod 的身份键（默认不动，先备份 .bak）
#   --yes        真正落盘；不带则只预览 diff
#
# 例：
#   bash deploy/rename.sh safecampus
#   bash deploy/rename.sh safecampus --brand "校园安全平台" --ports 3110,5283,5284,8090,8094 --env --yes
# ============
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OLD_SLUG="template"
OLD_BRAND="Template"

SLUG=""
BRAND=""
BRAND_GIVEN=0
PORTS=""
DO_ENV=0
CONFIRM=0

log()  { echo "==> $*"; }
warn() { echo "⚠️  $*" >&2; }
die()  { echo "✗ $*" >&2; exit 1; }

usage() {
  sed -n '/^# 用法：/,/^# ============/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' | sed '$d'
}

# ── 参数解析 ─────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --brand)   [ $# -ge 2 ] || die "--brand 需要值"; BRAND="$2"; BRAND_GIVEN=1; shift 2 ;;
    --ports)   [ $# -ge 2 ] || die "--ports 需要值"; PORTS="$2"; shift 2 ;;
    --env)     DO_ENV=1; shift ;;
    --yes)     CONFIRM=1; shift ;;
    -*)        die "未知参数：$1（--help 看用法）" ;;
    *)         [ -z "$SLUG" ] || die "只能给一个 slug（多余的：$1）"; SLUG="$1"; shift ;;
  esac
done

[ -n "$SLUG" ] || { usage; exit 1; }

# ── 校验 ─────────────────────────────────────────────────────────────
[[ "$SLUG" =~ ^[a-z][a-z0-9]{1,23}$ ]] \
  || die "slug 不合法：'$SLUG'。要求小写字母开头、仅含 a-z0-9、长度 2-24（库名不能带点号）"

[ "$SLUG" != "$OLD_SLUG" ] || die "slug 就是当前名（$OLD_SLUG），无需改名"

if [ "$BRAND_GIVEN" -eq 0 ]; then
  BRAND="${SLUG^}"
fi
case "$BRAND" in
  *平台|*系统) DISPLAY="$BRAND" ;;
  *)           DISPLAY="$BRAND 管理平台" ;;
esac

# --ports：3 个（dev）或 5 个（dev + prod nginx）
DEV_API=3010; DEV_ADMIN=5183; DEV_WEB=5184; PROD_ADMIN=8080; PROD_WEB=8084
if [ -n "$PORTS" ]; then
  IFS=',' read -r -a _p <<< "$PORTS"
  if [ "${#_p[@]}" -ne 3 ] && [ "${#_p[@]}" -ne 5 ]; then
    die "--ports 需要 3 个（api,admin,web）或 5 个（再加 prod_admin,prod_web）"
  fi
  for v in "${_p[@]}"; do
    [[ "$v" =~ ^[0-9]{2,5}$ ]] || die "端口不合法：'$v'"
  done
  DEV_API="${_p[0]}"; DEV_ADMIN="${_p[1]}"; DEV_WEB="${_p[2]}"
  if [ "${#_p[@]}" -eq 5 ]; then PROD_ADMIN="${_p[3]}"; PROD_WEB="${_p[4]}"; fi
fi

# ── 预检 ─────────────────────────────────────────────────────────────
# 版本控制是个人习惯，不强制：有 git 就做「工作区干净」保护（防止改到一半误改），
# 没有就只提醒一句然后继续。rename 本身不依赖 git。
HAS_GIT=0
if command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
  HAS_GIT=1
  DIRTY="$(git status --porcelain --untracked-files=no)"
  [ -z "$DIRTY" ] || die "工作区有未提交改动，先提交或 stash：
$DIRTY"
else
  warn "未检测到版本控制仓库：跳过工作区检查（建议先自行备份一份基线）"
fi

CUR_SLUG="$(sed -n 's/.*"name": *"\([a-z0-9-]*\)-server".*/\1/p' server/package.json | head -1)"
if [ "$CUR_SLUG" = "$SLUG" ]; then
  die "看起来已经改过名了（server/package.json 的包名已是 ${SLUG}-server）"
fi
[ "$CUR_SLUG" = "$OLD_SLUG" ] || warn "当前包名前缀是 '$CUR_SLUG'（非 $OLD_SLUG），按 $OLD_SLUG 规则继续"

for t in "deploy/$SLUG.sh" "deploy/nginx/$SLUG-admin.conf" "deploy/nginx/$SLUG-web.conf"; do
  [ -e "$t" ] && die "目标文件已存在：$t"
done

check_conflicts() {
  if command -v pm2 >/dev/null 2>&1; then
    if pm2 jlist 2>/dev/null | grep -q "\"name\":\"$SLUG-"; then
      warn "PM2 已有 '$SLUG-*' 进程，先确认不是隔壁项目（绝不 pm2 kill）"
    fi
  fi
  for s in "$SLUG-admin" "$SLUG-web"; do
    [ -e "/etc/nginx/sites-enabled/$s" ] && warn "Nginx 站点已存在：$s"
  done
  [ -e "/var/www/$SLUG" ] && warn "产物目录已存在：/var/www/$SLUG"
  for p in "$DEV_API" "$DEV_ADMIN" "$DEV_WEB" "$PROD_ADMIN" "$PROD_WEB"; do
    if command -v ss >/dev/null 2>&1 && ss -lnt 2>/dev/null | grep -q ":$p[[:space:]]"; then
      warn "端口 $p 已被占用（改名前旧项目可能正占着）"
    fi
  done
}
check_conflicts

# ── 待改文件 ─────────────────────────────────────────────────────────
discover() {
  find . -type f \
    -not -path './.git/*' -not -path '*/node_modules/*' \
    -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/coverage/*' \
    -not -path '*/logs/*' -not -path '*/docs/log/*' \
    -not -name '*.bak' -not -name 'pnpm-lock.yaml' \
    -not -path './server/.env.dev' -not -path './server/.env.test' -not -path './server/.env.prod' \
    -not -path './docs/RENAMED.md' -not -path './deploy/rename.sh' \
    -print0
}

sed_esc() { printf '%s' "$1" | sed 's/[\\&#]/\\&/g'; }
BRAND_SED="$(sed_esc "$BRAND")"
DISPLAY_SED="$(sed_esc "$DISPLAY")"

ports_patch() {
  local src="$1" f="$2"
  if grep -q '^DEV_API_PORT=' "$f" 2>/dev/null; then
    sed -i \
      -e "s#^DEV_API_PORT=3010\$#DEV_API_PORT=${DEV_API}#" \
      -e "s#^DEV_ADMIN_PORT=5183\$#DEV_ADMIN_PORT=${DEV_ADMIN}#" \
      -e "s#^DEV_WEB_PORT=5184\$#DEV_WEB_PORT=${DEV_WEB}#" \
      -e "s#ADMIN_PORT:-8080#ADMIN_PORT:-${PROD_ADMIN}#" \
      -e "s#WEB_PORT:-8084#WEB_PORT:-${PROD_WEB}#" "$f"
  fi
  if [[ "$src" == *"/web/vite.config.ts" ]]; then
    sed -i -e "s#port: 5184,#port: ${DEV_WEB},#" -e "s#127.0.0.1:3010#127.0.0.1:${DEV_API}#" "$f"
  fi
  if [[ "$src" == *"/web_admin/vite.config.ts" ]]; then
    sed -i -e "s#port: 5183,#port: ${DEV_ADMIN},#" -e "s#127.0.0.1:3010#127.0.0.1:${DEV_API}#" "$f"
  fi
  # conf 里的注释示例端口（8080/8084）跟着一起改，避免文档与变量不一致
  if [[ "$src" == */nginx/*.conf ]]; then
    # 用占位符中转，避免新端口恰好等于另一个旧端口时被二次替换
    sed -i -e "s#8080#@@PADM@@#g" -e "s#8084#@@PWEB@@#g" \
           -e "s#@@PADM@@#${PROD_ADMIN}#g" -e "s#@@PWEB@@#${PROD_WEB}#g" "$f"
  fi
}

build_new() {
  local src="$1" dst="$2"
  local -a e=()
  e+=(-e 's#<template#@@TG_OPEN@@#g')
  e+=(-e 's#</template#@@TG_CLOSE@@#g')
  e+=(-e 's#grid-template#@@TG_GRID@@#g')
  # JWT 禁用名单只增不减：旧值留着，防止派生项目把旧 secret 抄回来
  if [[ "$src" == */core/config/env.validation.ts ]]; then
    e+=(-e 's#nest-template-secret#@@TG_NSEC@@#g')
    e+=(-e 's#template-dev-secret#@@TG_DSEC@@#g')
    e+=(-e 's#template-test-secret#@@TG_TSEC@@#g')
  fi
  e+=(-e "s#Template 通用管理平台#${DISPLAY_SED}#g")
  e+=(-e "s#Template 管理平台#${DISPLAY_SED}#g")
  e+=(-e "s#NestTemplate#${BRAND_SED}#g")
  e+=(-e "s#Template#${BRAND_SED}#g")
  e+=(-e "s#template#${SLUG}#g")
  sed "${e[@]}" "$src" > "$dst"

  if [[ "$src" == */core/config/env.validation.ts ]]; then
    sed -i "/@@TG_NSEC@@/a\\  'nest-${SLUG}-secret', // ${SLUG} 的代码级兜底" "$dst"
  fi

  [ -n "$PORTS" ] && ports_patch "$src" "$dst"

  sed -i \
    -e 's#@@TG_OPEN@@#<template#g' \
    -e 's#@@TG_CLOSE@@#</template#g' \
    -e 's#@@TG_GRID@@#grid-template#g' \
    -e 's#@@TG_NSEC@@#nest-template-secret#g' \
    -e 's#@@TG_DSEC@@#template-dev-secret#g' \
    -e 's#@@TG_TSEC@@#template-test-secret#g' "$dst"
}

move_file() {
  local src="$1" dst="$2"
  # 有 git 且文件已跟踪 → 用 git mv 保留历史；其他情况一律普通 mv
  if [ "$HAS_GIT" -eq 1 ] && git ls-files --error-unmatch "$src" >/dev/null 2>&1; then
    git mv "$src" "$dst"
  else
    mv "$src" "$dst"
  fi
}

# ── 预览 / 执行 ──────────────────────────────────────────────────────
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

log "身份：$OLD_SLUG / $OLD_BRAND  →  $SLUG / $DISPLAY"
[ -n "$PORTS" ] && log "端口：dev $DEV_API/$DEV_ADMIN/$DEV_WEB  prod-nginx $PROD_ADMIN/$PROD_WEB"
echo

TOTAL_FILES=0
TOTAL_HITS=0
while IFS= read -r -d '' f; do
  grep -Iq . "$f" 2>/dev/null || continue
  # 端口目标（两个 vite.config.ts）不含项目名，--ports 时必须一并处理
  if [ -n "$PORTS" ] && [[ "$f" == *"/web/vite.config.ts" || "$f" == *"/web_admin/vite.config.ts" ]]; then
    :
  else
    grep -qi 'template' "$f" || continue
  fi
  build_new "$f" "$TMP/new"
  # 计数用 diff 的「仅变更行」格式：行首是 - / + 的内容（如 markdown 列表）不会干扰统计
  n="$(diff --unchanged-line-format= --old-line-format='%L' --new-line-format='%L' \
        "$f" "$TMP/new" 2>/dev/null | wc -l | tr -d ' ' || true)"
  [ "$n" -gt 0 ] || continue
  TOTAL_FILES=$((TOTAL_FILES + 1))
  TOTAL_HITS=$((TOTAL_HITS + n))

  if [ "$CONFIRM" -eq 1 ]; then
    cat "$TMP/new" > "$f"
    log "改：${f#./}（${n} 行）"
  else
    printf '   %-46s %3s 行\n' "${f#./}" "$n"
    diff -U1 "$f" "$TMP/new" | sed -n '3,30p' | sed 's/^/      /' || true
  fi
done < <(discover)

echo
log "待改文件 $TOTAL_FILES 个，改动行 $TOTAL_HITS 行"

RENAMES=(
  "deploy/$OLD_SLUG.sh|deploy/$SLUG.sh"
  "deploy/nginx/$OLD_SLUG-admin.conf|deploy/nginx/$SLUG-admin.conf"
  "deploy/nginx/$OLD_SLUG-web.conf|deploy/nginx/$SLUG-web.conf"
)
for pair in "${RENAMES[@]}"; do
  src="${pair%%|*}"; dst="${pair##*|}"
  [ -e "$src" ] || continue
  if [ "$CONFIRM" -eq 1 ]; then
    move_file "$src" "$dst"
    log "改名：$src → $dst"
  else
    echo "   改名：$src → $dst"
  fi
done

if [ "$DO_ENV" -eq 1 ]; then
  update_env() {
    local f="$1" db="$2" user="$3"
    [ -f "$f" ] || { warn "不存在，跳过：$f"; return 0; }
    cp -p "$f" "$f.bak"
    sed -i \
      -e "s#^APP_NAME=.*#APP_NAME=${SLUG}#" \
      -e "s#^DB_USERNAME=.*#DB_USERNAME=${user}#" \
      -e "s#^DB_DATABASE=.*#DB_DATABASE=${db}#" \
      -e "s#^STORAGE_S3_BUCKET=.*#STORAGE_S3_BUCKET=${SLUG}#" "$f"
    if [ -n "$PORTS" ] && [ "$f" = "server/.env.dev" ]; then
      sed -i -e "s#^PORT=.*#PORT=${DEV_API}#" "$f"
    fi
    log "env 已更新：$f（DB=${db}，账号=${user}，备份 $f.bak）"
  }
  # 一库一账号（见 server/sql/databases.sql / docs/库台账.md）：账号随库角色走，
  # 不再复用项目名当账号 —— 否则派生后 dev 与 prod 又落回同一个账号。
  if [ "$CONFIRM" -eq 1 ]; then
    update_env server/.env.dev  "$SLUG"         "${SLUG}_dev"
    update_env server/.env.test "${SLUG}_tmp"   "${SLUG}_tmp"
    update_env server/.env.prod "${SLUG}_prod"  "${SLUG}_prod"
  else
    echo "   env 将更新：server/.env.dev|.env.test|.env.prod 的 APP_NAME/DB_USERNAME/DB_DATABASE/STORAGE_S3_BUCKET"
    echo "   库与账号：$SLUG（账号 ${SLUG}_dev） / ${SLUG}_tmp（同账号） / ${SLUG}_prod（同账号）"
  fi
else
  echo "   env 未改（加 --env 才会动真实 .env.*）"
  echo "   改库名后**必须**在 server/sql/databases.sql 追加该项目段落，并到 MySQL 上跑一次；"
  echo "   否则一库一账号无法生效（见 docs/库台账.md §4 变更流程）"
fi

if [ "$CONFIRM" -eq 0 ]; then
  echo
  log "这只是预览。确认后重跑并加 --yes（建议先自行备份一份基线）"
  exit 0
fi

# ── 收尾：变更记录 + 残留自检 ────────────────────────────────────────
cat > docs/RENAMED.md <<EOF
# 项目身份变更记录

- 原身份：$OLD_SLUG / $OLD_BRAND 管理平台（通用底座）
- 新身份：$SLUG / $DISPLAY
- 变更时间：$(date '+%Y-%m-%d %H:%M')
- 执行脚本：deploy/rename.sh

## 已自动完成

- npm 包名、APP_NAME、DB 名（$SLUG / ${SLUG}_test / ${SLUG}_prod）、bucket、token key
- PM2 进程名、Nginx 站点名、产物/日志/备份路径
- 脚本与 conf 文件名、页面标题、文档正文
- 真实 .env.*：$( [ "$DO_ENV" -eq 1 ] && echo "已更新（.bak 备份）" || echo "未改（未加 --env）" )

## 仍需人工

见 docs/init.md：建库与授权、Redis 索引、bucket 权限、首个超管、端口实际占用核查。
EOF
log "已写：docs/RENAMED.md"

LEFT="$(while IFS= read -r -d '' f; do
  grep -nI 'template' "$f" 2>/dev/null | sed "s#^#${f#./}:#"
done < <(discover) | grep -vE '<template|</template|grid-template|nest-template-secret|template-(dev|test)-secret' || true)"

if [ -n "$LEFT" ]; then
  echo
  warn "还有未被规则覆盖的命中，请人工判断："
  echo "$LEFT" | sed 's/^/   /'
else
  log "残留自检通过（已跟踪文件里没有 template 了）"
fi

echo
log "下一步"
cat <<EOF
   1. 建库 + 授权：参考 docs/init.md（库 $SLUG / ${SLUG}_test / ${SLUG}_prod，账号 $SLUG）
   2. Redis 索引：确认 .env.* 的 REDIS_DB 是未被占用的编号
   3. 重新导出契约：cd server && pnpm openapi:dump
   4. 目录改名（脚本不动 cwd）：cd .. && mv $(basename "$ROOT") $SLUG
   5. 复核：确认文件已改名、无残留旧标识，再继续后续工作
EOF

[ -z "$LEFT" ] || exit 4
