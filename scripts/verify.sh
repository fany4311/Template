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

step "权限一致性（代码 ⇄ sys_permission ⇄ sys_menu）"
(cd server && pnpm authz:check)

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
