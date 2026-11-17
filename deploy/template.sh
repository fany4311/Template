#!/usr/bin/env bash
# ============================================================
# Template 管理平台 —— 部署总入口（一个文件接管 dev / prod 两套环境）
#
# 用法：
#   bash deploy/template.sh dev start             # 起开发环境（后端 3010 + 后台 5183 + 前端 5184）
#   bash deploy/template.sh dev stop              # 停开发环境（只停本项目进程）
#   bash deploy/template.sh dev restart           # 重启开发环境
#   bash deploy/template.sh dev status            # 进程/端口/健康检查
#   bash deploy/template.sh dev logs [api|admin|web]   # 看日志（默认后端）
#
#   bash deploy/template.sh prod start            # 生产：依赖 → 迁移 → 构建 → pm2 → 装站点 → 前端产物
#   bash deploy/template.sh prod start --no-build # 跳过依赖/迁移/构建，只重载进程与站点
#   bash deploy/template.sh prod stop             # 停生产（摘本项目站点软链 + 停后端，不碰 nginx 服务）
#   bash deploy/template.sh prod stop --purge     # 额外 pm2 delete + 删站点配置与前端产物
#   bash deploy/template.sh prod restart          # 只重启生产后端
#   bash deploy/template.sh prod status           # PM2 + 两个站点 + 健康检查
#   bash deploy/template.sh prod web              # 只重建+发布两个前端（并 reload nginx）
#   bash deploy/template.sh prod migrate          # 只跑数据库迁移
#   bash deploy/template.sh logs                  # 生产后端实时日志
#   bash deploy/template.sh --help
#
# 两套环境**完全隔离**，可以同时跑（这正是 dev 后端用 3010 的原因）：
#   dev  : 进程 *-dev    端口 3010 + 5183 + 5184（vite dev server，热更新）
#   prod : 进程 template-api-prod  端口 3000；前端由 nginx 托管
#          后台 8080（web_admin）/ 前端 8084（web）
#
# 端口为什么都不是「默认值」（同机多项目共存，别改回去）：
#   3000           —— 本项目 **prod** 后端占用，所以 dev 让到 3010
#   5173/5174      —— 隔壁 BigScreen 的 dev vite 占着，所以错到 5183/5184
#   8081           —— 隔壁 BigScreen 的 screen 站点占着，所以错到 8084
#
# 前端为什么是两个站点：后台（web_admin，仅超管/管理员可进）和前端（web，任何账号可登录）
# 面向的人不一样，拆开是为了「前端改版不用动后台、后台发版不影响前端」。
# 两者都只把 /api/ 转发给同一个后端（127.0.0.1:3000），所以 token 天然互通。
#
# 可覆盖的环境变量：
#   ADMIN_PORT=8080 / WEB_PORT=8084   站点端口
#     —— **这就是唯一端口来源**：nginx conf 里的 listen 是 __PORT__ 占位符，
#        安装时用这两个变量渲染。别再手工去改服务器上的 conf，改这里。
#   ADMIN_WEB_DEST / WEB_DEST         前端产物目录
#   PUBLIC_HOST=1.2.3.4               结尾展示的访问地址（默认取本机第一个 IP）
#
# 铁律（同机多项目共存）：
#   绝不 `pm2 kill`、绝不 `systemctl stop nginx`、绝不 `nginx -s stop`。
#   停服只停本项目进程、只摘本项目站点软链 —— 隔壁项目（如 BigScreen）不受影响。
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT/server"
ADMIN_DIR="$ROOT/web_admin"
WEB_DIR="$ROOT/web"
LOG_DIR="$ROOT/logs"

DEV_CONF="$ROOT/deploy/ecosystem.dev.config.cjs"
PROD_CONF="$ROOT/deploy/ecosystem.prod.config.cjs"
NGINX_ADMIN_CONF="$ROOT/deploy/nginx/template-admin.conf"
NGINX_WEB_CONF="$ROOT/deploy/nginx/template-web.conf"

# ── 身份（全部带 template 前缀，绝不与隔壁项目混）──
APP_PROD="template-api-prod"
DEV_APPS="template-api-dev template-web-admin-dev template-web-dev"
SITE_ADMIN="template-admin"
SITE_WEB="template-web"

# dev 端口（与 deploy/ecosystem.dev.config.cjs、两个 vite.config.ts 一致）
DEV_API_PORT=3010
DEV_ADMIN_PORT=5183
DEV_WEB_PORT=5184

# TODO(部署端) 与 nginx 配置里的 root 保持一致
ADMIN_WEB_DEST="${ADMIN_WEB_DEST:-/var/www/template/admin}"
WEB_DEST="${WEB_DEST:-/var/www/template/web}"
ADMIN_PORT="${ADMIN_PORT:-8080}"
WEB_PORT="${WEB_PORT:-8084}"

AVAIL_DIR="/etc/nginx/sites-available"
ENABLED_DIR="/etc/nginx/sites-enabled"

# 非 root 时用 sudo 执行系统级操作
SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

log()  { echo "==> $*"; }
warn() { echo "⚠️  $*" >&2; }
die()  { echo "✗ $*" >&2; exit 1; }

usage() {
  sed -n '/^# 用法：/,/^# ============/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' | sed '$d'
}

require_pm2() {
  command -v pm2 >/dev/null 2>&1 || die "未安装 pm2：npm i -g pm2"
}

# 生产必须能读到 .env.prod，否则会拿代码默认值去连库/连存储，起来一个"活着但连不上"的进程
require_env_prod() {
  [ -f "$SERVER_DIR/.env.prod" ] || die "缺少 $SERVER_DIR/.env.prod（从 deploy/.env.prod.example 复制后填写）"
}

pm2_has() { command -v pm2 >/dev/null 2>&1 && pm2 describe "$1" >/dev/null 2>&1; }

nginx_reload() {
  if $SUDO nginx -t >/dev/null 2>&1; then
    $SUDO systemctl reload nginx
    log "Nginx：已 reload（进程未停止，其它站点照常服务）"
  else
    warn "nginx -t 校验未通过，已跳过 reload；请手动检查 /etc/nginx/"
    $SUDO nginx -t || true
  fi
}

# 探一个端口是否真的在服务。
# 后端必须探 /api/v1/health/ready 而不是根路径：Nest 没有 `/` 路由，根路径必然 404，
# 用根路径会把正常进程误报成"未响应"。
probe() { # probe <port> <path> <名称>
  if command -v curl >/dev/null 2>&1 && curl -fsS -m 3 -o /dev/null "http://127.0.0.1:$1$2" 2>/dev/null; then
    echo "  $1  $3   OK"
  else
    echo "  $1  $3   未响应"
  fi
}

# ============================================================
#  dev：三条进程全归 pm2 管（后端 + 两个 vite dev server）
# ============================================================
cmd_dev_start() {
  require_pm2
  echo "================================================"
  echo " Template DEV    后端 $DEV_API_PORT · 后台 $DEV_ADMIN_PORT · 前端 $DEV_WEB_PORT"
  echo "================================================"
  mkdir -p "$LOG_DIR/dev"

  log "[1/2] 检查后端构建产物"
  [ -f "$SERVER_DIR/dist/main.js" ] || die "缺少 $SERVER_DIR/dist/main.js，先跑：cd server && pnpm build"

  log "[2/2] PM2 启动/重载 dev 三件套"
  # startOrReload 不会打断正在跑的同名进程；改了 cjs 就生效
  pm2 startOrReload "$DEV_CONF" --update-env
  pm2 save >/dev/null 2>&1 || true

  print_dev_urls
}

cmd_dev_stop() {
  require_pm2
  echo "================================================"
  echo " Template DEV 停止（只停本项目进程）"
  echo "================================================"
  for app in $DEV_APPS; do
    if pm2_has "$app"; then
      pm2 stop "$app" >/dev/null
      echo "    stopped  $app"
    else
      echo "    skip     $app（不在 PM2 中）"
    fi
  done
  pm2 save >/dev/null 2>&1 || true
  echo "================================================"
  echo "✅ dev 已停（PM2 守护进程、prod 进程、nginx 都没动）"
  echo "================================================"
}

cmd_dev_restart() {
  require_pm2
  cmd_dev_start
}

cmd_dev_status() {
  echo "== PM2 =="
  if ! command -v pm2 >/dev/null 2>&1; then
    warn "未安装 pm2"
  else
    for app in $DEV_APPS; do
      if pm2_has "$app"; then
        pm2 jlist 2>/dev/null | APP="$app" python3 -c "
import json,os,sys
d=json.load(sys.stdin); a=os.environ['APP']
for p in d:
    if p['name']==a:
        e=p['pm2_env']
        print(f\"  {a:36s} {e.get('status'):8s} restarts={e.get('restart_time')}\")
" || echo "  $app ?"
      else
        echo "  $app 未运行"
      fi
    done
  fi

  echo
  echo "== 端口 =="
  probe "$DEV_API_PORT"   "/api/v1/health/ready" "后端"
  probe "$DEV_ADMIN_PORT" "/"                    "后台"
  probe "$DEV_WEB_PORT"   "/"                    "前端"

  echo
  echo "== 健康检查 =="
  command -v curl >/dev/null 2>&1 \
    && { curl -fsS -m 3 "http://127.0.0.1:$DEV_API_PORT/api/v1/health/ready" 2>/dev/null | head -c 300 || echo "  未响应"; echo; } \
    || warn "未安装 curl，跳过"
}

cmd_dev_logs() {
  require_pm2
  case "${1:-api}" in
    api)   pm2 logs template-api-dev ;;
    admin) pm2 logs template-web-admin-dev ;;
    web)   pm2 logs template-web-dev ;;
    *) die "未知日志目标：$1（api|admin|web）" ;;
  esac
}

print_dev_urls() {
  local host="${PUBLIC_HOST:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
  [ -z "$host" ] && host="localhost"
  echo "================================================"
  echo "✅ dev 就绪（vite 热更新，改代码不用重启）"
  echo "   后台    http://$host:$DEV_ADMIN_PORT/"
  echo "   前端    http://$host:$DEV_WEB_PORT/"
  echo "   接口    http://127.0.0.1:$DEV_API_PORT/api/v1"
  echo "   接口文档 http://127.0.0.1:$DEV_API_PORT/api/docs"
  echo ""
  echo "   状态    bash deploy/template.sh dev status"
  echo "   日志    bash deploy/template.sh dev logs admin"
  echo "   停止    bash deploy/template.sh dev stop"
  echo "================================================"
}

# ============================================================
#  prod：后端交给 pm2，前端静态产物交给 nginx
# ============================================================
step_install() {
  log "[1/6] 后端依赖：pnpm install --frozen-lockfile"
  (cd "$SERVER_DIR" && pnpm install --frozen-lockfile)
}

# 数据库迁移：**生产 DB_SYNCHRONIZE=false，不跑迁移就是空库启动**
# NODE_ENV=prod 必须显式带上：data-source.ts 按 NODE_ENV 加载 .env.$NODE_ENV，
# 不写就是默认 dev —— 会连到开发库上执行迁移，属于"手滑改错库"级别的错误。
# 该脚本内部含一次 pnpm build（TypeORM CLI 加载的是 dist/），失败即中止，不启动新版本。
step_migrate() {
  log "[2/6] 数据库迁移：NODE_ENV=prod pnpm migration:run"
  (cd "$SERVER_DIR" && NODE_ENV=prod pnpm migration:run)
}

step_build() {
  log "[3/6] 后端构建：pnpm build"
  (cd "$SERVER_DIR" && pnpm build)
}

step_pm2() {
  require_pm2
  mkdir -p "$SERVER_DIR/logs"

  # 权限清单同步：把代码里的 `@RequiresPermissions` 反射进 sys_permission，
  # 角色界面靠它渲染「按模块分组树形勾选」。
  # **失败不阻断启动**：清单只是界面数据源，不参与鉴权（RbacGuard 只看角色权限串），
  # 因清单同步失败而停服，等于把可用性问题升级成可用性事故。
  log "[4/6] 后端：同步权限清单：NODE_ENV=prod node dist/scripts/authz-sync.js"
  (cd "$SERVER_DIR" && NODE_ENV=prod node dist/scripts/authz-sync.js) \
    || warn "权限清单同步失败：后台角色界面可能缺少最新权限码（不影响已有鉴权）"

  if pm2_has "$APP_PROD"; then
    log "[4/6] 后端：PM2 重载 $APP_PROD"
    pm2 startOrReload "$PROD_CONF" --update-env
  else
    log "[4/6] 后端：PM2 启动 $APP_PROD"
    pm2 start "$PROD_CONF"
  fi
  pm2 save >/dev/null 2>&1 || true
}

nginx_install() {
  log "[5/6] Nginx：安装两个站点（后台 $ADMIN_PORT / 前端 $WEB_PORT，不占 80、不动其它站点）"
  # conf 里的 listen 是 __PORT__ 占位符 → 用环境变量渲染后落盘。
  # 用 tee 而不是 cp：目标是 root-owned，且要一边替换一边写（别改坏仓库里的模板）。
  render_conf() { sed "s/__PORT__/$2/g" "$1" | $SUDO tee "$AVAIL_DIR/$3" >/dev/null; }
  render_conf "$NGINX_ADMIN_CONF" "$ADMIN_PORT" "$SITE_ADMIN"
  render_conf "$NGINX_WEB_CONF"   "$WEB_PORT"   "$SITE_WEB"

  # 拆分前的旧站点（名叫 template，也听 8080）必须摘掉软链，否则新站点抢不到端口。
  # **只摘软链，不删配置**：配置文件和站点内容全部保留，要恢复很容易。
  # 不摘的话：8080 被两个 site 同时声明，nginx 取先加载的那个，
  # 表现为「改了 conf 但 8080 还是旧页面」，很难查。
  if [ -e "$ENABLED_DIR/template" ] || [ -L "$ENABLED_DIR/template" ]; then
    warn "发现拆分前的旧站点 template（也听 $ADMIN_PORT）——已摘掉它的软链避免抢端口"
    warn "  配置仍在 $AVAIL_DIR/template，确认无用了可自行删除"
    $SUDO rm -f "$ENABLED_DIR/template"
  fi

  $SUDO ln -sf "$AVAIL_DIR/$SITE_ADMIN" "$ENABLED_DIR/$SITE_ADMIN"
  $SUDO ln -sf "$AVAIL_DIR/$SITE_WEB"   "$ENABLED_DIR/$SITE_WEB"
}

step_web() {
  log "[6/6] 前端：构建 → 部署到 $ADMIN_WEB_DEST / $WEB_DEST"

  (cd "$ADMIN_DIR" && pnpm install --frozen-lockfile && pnpm build)
  $SUDO mkdir -p "$ADMIN_WEB_DEST"
  # Nginx 以 www-data 运行，产物必须世界可读
  $SUDO rsync -a --delete "$ADMIN_DIR/dist/" "$ADMIN_WEB_DEST/"
  $SUDO chmod -R a+rX "$ADMIN_WEB_DEST"

  (cd "$WEB_DIR" && pnpm install --frozen-lockfile && pnpm build)
  $SUDO mkdir -p "$WEB_DEST"
  $SUDO rsync -a --delete "$WEB_DIR/dist/" "$WEB_DEST/"
  $SUDO chmod -R a+rX "$WEB_DEST"
}

print_prod_urls() {
  local host="${PUBLIC_HOST:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
  [ -z "$host" ] && host="localhost"
  echo "================================================"
  echo "✅ 生产部署完成"
  echo "   后台      http://$host:$ADMIN_PORT/     （仅超管/管理员可进）"
  echo "   前端      http://$host:$WEB_PORT/"
  echo "   接口      http://$host:$ADMIN_PORT/api/v1"
  echo "   接口文档  http://$host:$ADMIN_PORT/api/docs"
  echo "   健康检查  http://$host:$ADMIN_PORT/health"
  echo ""
  echo "   后端进程  $APP_PROD（pm2，监听 127.0.0.1:3000）"
  echo "   状态      bash deploy/template.sh prod status"
  echo "   日志      bash deploy/template.sh logs"
  echo "   停服      bash deploy/template.sh prod stop"
  echo "================================================"
}

cmd_prod_start() {
  local build=1
  [ "${1:-}" = "--no-build" ] && build=0

  echo "================================================"
  echo " Template PROD  后台=$ADMIN_PORT 前端=$WEB_PORT  build=$build"
  echo "================================================"

  require_env_prod

  if [ "$build" -eq 1 ]; then
    step_install
    step_migrate
    step_build
  else
    log "[1/6] 跳过依赖安装（--no-build）"
    log "[2/6] 跳过数据库迁移（--no-build）—— 结构有变更时请单独跑 bash deploy/template.sh prod migrate"
    log "[3/6] 跳过后端构建（--no-build）"
  fi

  step_pm2
  nginx_install

  if [ "$build" -eq 1 ]; then
    step_web
  else
    log "[6/6] 跳过前端构建（--no-build）"
  fi

  nginx_reload
  check_accounts
  print_prod_urls
}

cmd_prod_stop() {
  local purge=0
  [ "${1:-}" = "--purge" ] && purge=1

  echo "================================================"
  echo " Template PROD 停止   purge=$purge"
  echo "================================================"

  log "[1/2] 后端：停 PM2 应用（不动 PM2 守护进程）"
  if pm2_has "$APP_PROD"; then
    if [ "$purge" -eq 1 ]; then
      pm2 delete "$APP_PROD"
      echo "    已从 PM2 移除 $APP_PROD"
    else
      pm2 stop "$APP_PROD"
      echo "    已停止 $APP_PROD（进程定义保留，start 可秒级恢复）"
    fi
  else
    echo "    $APP_PROD 未在 PM2 中，跳过"
  fi

  log "[2/2] Nginx：下线本项目两个站点（不停止 Nginx、不影响其它站点）"
  for site in "$SITE_ADMIN" "$SITE_WEB"; do
    if [ -e "$ENABLED_DIR/$site" ] || [ -L "$ENABLED_DIR/$site" ]; then
      $SUDO rm -f "$ENABLED_DIR/$site"
      echo "    已移除 $ENABLED_DIR/$site"
    else
      echo "    $ENABLED_DIR/$site 不存在，跳过"
    fi
  done
  nginx_reload

  if [ "$purge" -eq 1 ]; then
    log "[purge] 清理站点配置与前端产物"
    for site in "$SITE_ADMIN" "$SITE_WEB"; do
      $SUDO rm -f "$AVAIL_DIR/$site"
      echo "    已删除 $AVAIL_DIR/$site"
    done
    $SUDO rm -rf "$ADMIN_WEB_DEST" "$WEB_DEST"
    echo "    已删除 $ADMIN_WEB_DEST 与 $WEB_DEST"
  fi

  echo "================================================"
  echo "✅ 已停止部署"
  echo "   Nginx 服务、PM2 守护进程保持运行（其它项目不受影响）"
  echo "   数据库、日志、上传文件（MinIO）未触碰"
  echo "   重新上线：bash deploy/template.sh prod start"
  echo "================================================"
}

cmd_prod_restart() {
  require_pm2
  log "重启生产后端 $APP_PROD"
  pm2 restart "$PROD_CONF" --update-env
  pm2 save >/dev/null 2>&1 || true
}

cmd_prod_status() {
  echo "== PM2 =="
  if ! command -v pm2 >/dev/null 2>&1; then
    warn "未安装 pm2"
  elif pm2_has "$APP_PROD"; then
    pm2 status "$APP_PROD" || true
  else
    echo "  未运行（$APP_PROD 不在 PM2 中）"
  fi

  echo
  echo "== Nginx 站点 =="
  for pair in "$SITE_ADMIN:$ADMIN_PORT:后台" "$SITE_WEB:$WEB_PORT:前端"; do
    site="$(echo "$pair" | cut -d: -f1)"
    port="$(echo "$pair" | cut -d: -f2)"
    name="$(echo "$pair" | cut -d: -f3)"
    if [ -e "$ENABLED_DIR/$site" ]; then
      echo "  $name  已启用  $ENABLED_DIR/$site  →  http://<host>:$port/"
    else
      echo "  $name  未启用（$ENABLED_DIR/$site 不存在）"
    fi
  done
  if command -v nginx >/dev/null 2>&1; then
    $SUDO nginx -t 2>&1 | sed 's/^/  /' || true
  fi

  echo
  echo "== 健康检查 =="
  if command -v curl >/dev/null 2>&1; then
    echo -n "  后端直连 3000: "
    curl -fsS -m 3 http://127.0.0.1:3000/api/v1/health/ready 2>/dev/null | head -c 200 || echo -n "未响应"
    echo
    echo -n "  经站点 $ADMIN_PORT/health: "
    curl -fsS -m 3 "http://127.0.0.1:$ADMIN_PORT/health" 2>/dev/null | head -c 200 || echo -n "未响应"
    echo
  else
    warn "未安装 curl，跳过"
  fi
}

cmd_prod_web() {
  log "只部署前端（后台 + 前端）"
  require_pm2
  step_web
  nginx_reload
  print_prod_urls
}

cmd_prod_migrate() {
  require_env_prod
  step_migrate
}

# 迁移只建**表结构 + 内置角色 + 菜单/字典**，不建任何账号（底座的设计）。
# 不提醒的话，第一次部署完会卡在「登录不进去」—— 而这个现象看起来像密码错了。
check_accounts() {
  [ -f "$SERVER_DIR/dist/core/database/data-source.js" ] || return 0
  local n
  n="$(cd "$SERVER_DIR" && NODE_ENV=prod node -e "
import('./dist/core/database/data-source.js').then(async (m) => {
  const ds = m.default; await ds.initialize();
  const r = await ds.query('SELECT COUNT(*) AS n FROM sys_user');
  await ds.destroy(); console.log(Number(r[0].n));
}).catch(() => console.log('?'));
" 2>/dev/null | tail -1)"
  if [ "$n" = "0" ]; then
    warn "数据库里还没有任何账号 —— 平台无法登录。"
    echo "      说明：迁移只建表结构与内置角色，账号需另行初始化。"
    echo "      参考 docs/部署端环境.md「首次部署」一节。"
  fi
}

cmd_prod_logs() {
  require_pm2
  pm2 logs "$APP_PROD"
}

# ---------------- 分发 ----------------

ENV="${1:-}"
case "$ENV" in
  dev)
    case "${2:-}" in
      start)   cmd_dev_start ;;
      stop)    cmd_dev_stop ;;
      restart) cmd_dev_restart ;;
      status)  cmd_dev_status ;;
      logs)    cmd_dev_logs "${3:-api}" ;;
      *)       echo "dev 子命令：start|stop|restart|status|logs [api|admin|web]" >&2; exit 1 ;;
    esac ;;
  prod)
    case "${2:-}" in
      start)   cmd_prod_start "${3:-}" ;;
      stop)    cmd_prod_stop "${3:-}" ;;
      restart) cmd_prod_restart ;;
      status)  cmd_prod_status ;;
      web)     cmd_prod_web ;;
      migrate) cmd_prod_migrate ;;
      logs)    cmd_prod_logs ;;
      *)       echo "prod 子命令：start [--no-build]|stop [--purge]|restart|status|web|migrate|logs" >&2; exit 1 ;;
    esac ;;
  # 兼容老用法：不带 dev/prod 前缀时按 prod 处理
  logs)  cmd_prod_logs ;;
  -h|--help|help|"")
    usage; [ -z "$ENV" ] && exit 1 || exit 0 ;;
  *)
    echo "未知命令：$ENV" >&2
    usage >&2
    exit 1 ;;
esac
