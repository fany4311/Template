# web —— 前端（面向业务用户）

**当前是最小壳**：登录页 → 登录成功页。没有菜单、没有动态路由、不引 UI 库。

## 它为什么存在

底座（`Template`）的前端拆成了两份，面向的人不一样：

| | `web_admin`（后台） | `web`（本目录） |
|---|---|---|
| 端口 | dev 5183 / prod **8080** | dev 5184 / prod **8084** |
| 面向谁 | 超管 / 管理员 | 全体业务用户 |
| 准入 | 需要权限码 `console:access` | 任何能登录的账号 |
| 内容 | 动态菜单、用户/角色/部门/字典/日志、隐患管理 | 登录 + 登录成功 |

拆分动机是**解耦发版**：前端改版不用动后台，后台发版不影响前端。
两者共用同一个 Nest 后端（`/api/` 都转发到 `127.0.0.1:3010`(dev) / `3000`(prod)），
token 天然互通。

## 技术栈

| 包 | 版本 |
|---|---|
| vue | 3.5 |
| vue-router | 4.x（上一代成熟主版本） |
| pinia | 3.x |
| axios | 1.x |
| vite | 7.x（上一代成熟主版本） |
| @vitejs/plugin-vue | 6.x（与 vite 7 配对） |
| typescript | 5.9 |
| vue-tsc | 3.x |

**故意不装 `element-plus`**：最小壳不需要，装了会平白多 1MB+ 产物和一套样式重置。
真要长出业务页面时再引，顺便把 `web_admin` 的 `v-perm` 指令和动态菜单机制搬过来。

## 脚本

```bash
pnpm install
pnpm dev          # 开发服务器（5184，/api 代理到 127.0.0.1:3010）
pnpm build        # vue-tsc 类型检查 + 构建到 dist/
pnpm typecheck    # 仅类型检查
```

或者用 PM2 一把起 dev 三件套（后端 + 后台 + 前端）：`bash deploy/template.sh dev start`。

## 目录

```
src/
  api/
    http.ts          # axios 封装：解包 {code,msg,data}、401 处理、幂等键
    auth.ts          # 登录 / 登出 / 取档案
    types.ts         # 登录结果与档案类型
  stores/auth.ts     # token + 档案 + 权限判定
  router/index.ts    # 路由 + 守卫（登录态）
  utils/permission.ts# 与后端同源的权限码匹配（通配 + deny 优先）
  views/
    LoginView.vue
    HomeView.vue     # 登录成功页
```

## 与后端的约定

- **响应包络**：所有接口返回 `{ code, msg, data }`，`code === 200` 才算成功。
  业务异常也是 **HTTP 200 + `code: 403/500`**（`ApiException` 约定），框架异常才用真实 HTTP 状态。
  因此拦截器只看 `body.code`，不看 HTTP 状态。
- **鉴权**：`Authorization: Bearer <token>`；token 存在 `localStorage` 的 `template_token`。
- **幂等**：带 `@Idempotent()` 的接口要求 `Idempotency-Key` 头（缺失直接 400）。
  `request.post()` 默认自动带一个 UUID，无需调用方关心。

## 环境变量（可选）

| 变量 | 默认 | 说明 |
|---|---|---|
| `VITE_API_BASE_URL` | `/api/v1` | 接口前缀 |
| `VITE_CAPTCHA_ENABLED` | `false` | 是否展示图形验证码（需与后端 `CAPTCHA_ENABLED` 一致） |

## 部署

`pnpm build` 产物 `dist/` 由 Nginx 站点 `template-web` 托管（端口 8084），
`/api` 反代到 Nest。见 `../deploy/nginx/template-web.conf`。

## 两个坑（都踩过，别再踩）

### 1. `crypto.randomUUID` 是安全上下文限定 API

它只在 `https://` 或 `http://localhost | 127.0.0.1` 下存在。校内用
`http://内网IP:8084` 打开时它是 **undefined**，调用直接抛 `TypeError`，
异常发生在 axios 发请求之前，服务端一条日志都没有。

所以 `src/api/http.ts` 的 `newIdempotencyKey()` 用 `crypto.getRandomValues()` 自拼 UUID。

### 2. 端口必须 `strictPort`

`vite.config.ts` 里开了 `strictPort: true`：5184 被占时**直接报错**，不会悄悄换端口。
自动换端口的结果是「你改的代码没生效」，比报错难排查得多。
