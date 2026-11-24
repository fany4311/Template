#!/usr/bin/env bash
# 一键校验：提交前跑一遍，等价于「本地 CI」
# 用法：bash scripts/verify.sh [--fast]
#   --fast  跳过单测、格式检查与前端构建（只做类型/lint/权限一致性），改文档时用
#
# E2E 不在本脚本内：它需要一个跑着的 dev 环境（`pnpm -C web_admin test:e2e`），
# 混进来会让「提交前校验」变成「必须先把服务跑起来」。
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
FAST=0
[ "${1:-}" = "--fast" ] && FAST=1

step() { echo; echo "==> $*"; }

step "后端类型检查"
(cd server && npx tsc -p tsconfig.build.json --noEmit)

step "后端 lint"
(cd server && pnpm lint)

step "权限一致性（代码 ⇄ sys_permission ⇄ sys_menu，env=${NODE_ENV:-dev}）"
(cd server && NODE_ENV="${NODE_ENV:-dev}" pnpm authz:check)

# 迁移一致性：代码里有、库里没跑 → 派生/上线最经典的 500 制造机。
# TypeORM 的 `migration:show` 用 `[X]` 标记已执行、`[ ]` 标记未执行。
# 用 if 而不是 `cmd && die`：grep 没匹配到时是非零，直接跟 && 会被 set -e 判成失败。
# 环境可继承：本地默认 dev；要在部署端校验 prod 就 `NODE_ENV=prod bash scripts/verify.sh`。
# ⚠ 别写死 dev —— 部署端可能根本没建 dev 库，那会误报成"脚本坏了"。
# （prod 侧其实不需要这道门禁：`template.sh prod start` 第 2 步就是 migration:run，
#   漏跑迁移 prod 起不来。这里挡的是"改了代码忘了跑迁移"的人为疏漏。）
CHECK_ENV="${NODE_ENV:-dev}"
step "迁移一致性（代码 ⇄ 库，env=$CHECK_ENV）"
if (cd server && NODE_ENV="$CHECK_ENV" pnpm migration:show 2>/dev/null) | grep -q '^\[ \]'; then
  echo "✗ 有迁移未在 $CHECK_ENV 库执行，先跑：cd server && NODE_ENV=$CHECK_ENV pnpm migration:run" >&2
  exit 1
fi
echo "    $CHECK_ENV 库已与代码迁移对齐"

step "前端 lint（web_admin / web）"
(cd web_admin && pnpm lint)
(cd web && pnpm lint)

if [ "$FAST" -eq 0 ]; then
  step "后端单测"
  (cd server && pnpm test)


  step "格式检查（oxfmt）"
  (cd server && pnpm format:check)
  (cd web_admin && pnpm format:check)
  (cd web && pnpm format:check)

  step "前端类型检查"
  (cd web_admin && pnpm typecheck)

  step "前端构建"
  (cd web_admin && pnpm build)
  (cd web && pnpm build)
fi

echo
echo "✓ 校验全部通过"
