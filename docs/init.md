# 派生新项目：初始化清单

> 底座代码是对的，但**身份与连接全是上一个项目的**。
> 直接跑 = 连别人的库、抢别人的端口和进程名。
>
> 顺序：**先跑改名脚本**（名字类它全包），**再处理机器侧**（库/Redis 索引/端口/bucket/超管，脚本碰不到）。
> 本文件写在底座仓库里（会随 tag 一起被派生）。**实现有变化时更新这里**，
> 派生出去的项目只读它，不要各自复制粘贴。

## 0. 改名：`deploy/rename.sh`

```bash
bash deploy/rename.sh <slug>                      # 预览：逐文件 diff + 文件改名计划，不落盘
bash deploy/rename.sh <slug> \
     --brand "显示全称" \
     --ports <api,admin,web[,prod_admin,prod_web]> \
     --env --yes                                  # 确认落盘
```

一次改掉（**不需要人再逐个改**）：

| 类别 | 具体项 |
|---|---|
| 包与配置 | npm 包名（`<slug>-server` / `-web` / `-web-admin`）、`APP_NAME` |
| 数据侧 | 库名 `<slug>` / `<slug>_test` / `<slug>_prod`、bucket、TypeORM 兜底库名 |
| 前端 | `token key`（`<slug>_token`）、页面标题、路由标题、登录页与侧栏品牌名 |
| 进程与站点 | PM2 进程名、Nginx 站点名、产物/日志/备份路径 |
| 文件名 | `deploy/<slug>.sh`、`deploy/nginx/<slug>-{admin,web}.conf` |
| 文档 | README、AGENTS.md、docs/（`docs/log/` 历史只读，不动） |

设计约束（改之前值得知道）：

- **只替换白名单词元**，不做全仓 `sed s/template/xxx/`：`.vue` 里的 `<template>` 标签、
  CSS 的 `grid-template-columns` 都被保护；替换后做残留自检，漏网就报错退出。
- **JWT 禁用名单只增不减**：`env.validation.ts` 的旧 secret 条目保留，新名字另加一条。
  否则派生项目把旧 secret 抄回来就绕过了校验。
- `--brand` 以「平台/系统」结尾时不再追加「管理平台」。
- 默认要求工作区干净、只预览不落盘；`--yes` 才写文件。失败不自动回滚（怕误删未跟踪文件），
  手工还原改动即可回到基线。
- `--env` 只改三份真实 `.env.*` 的身份键（`APP_NAME` / `DB_USERNAME` / `DB_DATABASE` / `STORAGE_S3_BUCKET`，
  含 `--ports` 时还有 dev 的 `PORT`），改前留 `.bak`；不碰 `JWT_SECRET` 与密码。
- 收尾写 `docs/RENAMED.md`（原身份、新身份、时间、仍待人工项），便于日后追溯。

## 1. 人工必改（脚本碰不到机器）

| 项 | 换成 | 备注 |
|---|---|---|
| MySQL 库 | `<slug>` / `<slug>_test` / `<slug>_prod` | 脚本只改连接串，**库要自己建**。库名不要带点号：`GRANT ALL ON a.b.*` 会被解析成「库 a + 表 b」 |
| MySQL 账号 | 新建独立用户 + 独立密码 | 不复用别的项目账号；`.env.*` 的 `DB_PASSWORD` 手工填 |
| Redis DB 索引 | 未被占用的编号 | 先 `redis-cli INFO keyspace` 看已用哪些，再改 `.env.*` 的 `REDIS_DB` |
| 端口 | 全局唯一 | `--ports` 只改配置文件；**机器上谁在监听要自己看**（脚本会提示占用）。已占：dev `3010/5183/5184`、prod `3000/8080/8084`（本机 SafeCampus）、`5173/5174/8081/8082`（BigScreen） |
| 生产后端端口 | `.env.prod` 的 `PORT` | 脚本不改真实 env 的端口（dev 除外），生产要手工对齐 |
| bucket | 独立私有桶 | 建桶 + 权限，见 §2 |
| 首个超管 | 自己插 | 迁移**刻意不建账号**，见 §3 |

改名后复查（脚本收尾已按「旧标识」自检；手工复查把 `<旧标识>` 换成上一个项目名）：

```bash
grep -rn "<旧标识>" --exclude-dir=node_modules --exclude-dir=dist .
```

## 2. 存储：二选一

底座只认 **disk 名字**，换引擎改配置即可，业务代码零改动。

```ini
STORAGE_DRIVER=local          # local（默认，推荐）/ s3 / memory(仅测试)
STORAGE_DISK=default
STORAGE_LOCAL_ROOT=./data/uploads
```

**默认用 `local`**：单机部署、离线演示、不想额外依赖对象存储时选它，
把 `STORAGE_LOCAL_ROOT` 指向一个**会做备份**的目录即可。

用 MinIO / S3 兼容存储时改成：

```ini
STORAGE_DRIVER=s3
STORAGE_S3_ENDPOINT=http://127.0.0.1:9010
STORAGE_S3_BUCKET=<新项目独立 bucket>
STORAGE_S3_ACCESS_KEY=<...>
STORAGE_S3_SECRET_KEY=<...>
STORAGE_S3_FORCE_PATH_STYLE=true          # 自建存储必须 path-style
STORAGE_S3_SERVER_SIDE_ENCRYPTION=false   # MinIO 未开 KMS 时保持 false
```

> bucket 必须**独立**（不要复用别的项目的），且保持**私有**：下载走后端代理。
> 用 s3 时 `STORAGE_LOCAL_ROOT` 可留着不管（不生效）。

## 3. 配置与初始化

```bash
cd server
cp .env.example .env.dev
cp .env.example .env.test
cp ../deploy/.env.prod.example .env.prod     # 填 NODE_ENV=prod
```

> 跑过 `rename.sh --env` 的话，三份 `.env.*` 已在且身份键已改，只需补库/Redis/密码，不用重新 `cp`。

三份 env 都要确认：

- `NODE_ENV`：dev / test / prod
- `DB_*`、`REDIS_DB`、`STORAGE_*`：见上表
- **`DB_SYNCHRONIZE=false`** ⚠️
- `PORT`：换成自己的

> ⚠️ **`DB_SYNCHRONIZE` 必须 `false`**。
> `true` 会**抢先于迁移**自动改表：迁移里的 DDL 变成"重复添加列"直接失败，
> 而表结构看起来又是"对的"（synchronize 加的，索引/注释与迁移不一致），极难排查。
> **schema 变更的唯一合法途径是迁移。**

> ⚠️ `.env.prod` 的 `NODE_ENV` 必须是 `prod`，否则等于**连开发库跑生产迁移**。

```bash
# 装依赖（三个目录独立）
(cd server && pnpm install)
(cd web && pnpm install)
(cd web_admin && pnpm install)

# 建表 + 种子（内置 5 角色/菜单/字典/参数）
(cd server && NODE_ENV=dev  pnpm migration:run)
(cd server && NODE_ENV=test pnpm migration:run)

# 权限清单（后台角色界面「树形勾选」的数据源）
(cd server && pnpm authz:sync)

# 接口契约（改了标题/包名后重新导出，喂给 web_admin）
(cd server && pnpm openapi:dump)
```

### 建首个超管

迁移**刻意不建账号**（避免默认密码后门）。密码是 argon2 哈希：

```bash
cd server && node -e "
const { hash } = require('@node-rs/argon2');
hash('改成强密码').then(console.log);"
```

再插 `sys_user` + `sys_user_role`（角色用 `level = 0` 定位，不要用角色名——名字可改）。
落地前先 `DESC sys_user;` 核对列名。

验证：登录后 `GET /api/v1/auth/profile` 返回 `roles: [0]`、`permissions: ["*:*:*"]`。

## 4. 验收

```bash
(cd server && npx tsc -p tsconfig.build.json --noEmit && pnpm lint && pnpm test)
(cd server && NODE_ENV=test pnpm test:e2e)
(cd web_admin && pnpm typecheck && pnpm build)
(cd web && pnpm typecheck && pnpm build)
```

```sql
SELECT level, role_name, is_builtin, permissions FROM sys_role ORDER BY level;  -- 5 个内置
SELECT COUNT(*) FROM sys_permission;   -- > 0（同步过）
```

## 5. 同机共存铁律

- ❌ 绝不 `pm2 kill`（杀全机项目）、绝不 `systemctl stop nginx` / `nginx -s stop`
  （下线全机站点）。重载用 `nginx -t && nginx -s reload`，只增删本项目站点软链。
- ❌ 绝不跨项目改数据库，尤其别对不认识的库跑迁移。
- ⚠️ 端口 / PM2 名 / 站点名 / 目录 / token key，**每一样都必须全局唯一**。
- ⚠️ 容器（mysql/redis/minio）可共享，但**库 / Redis 索引 / bucket 必须各自独立**。

## 6. 部署侧易错点

- **上传大小三层对齐**：Nginx `client_max_body_size` ↔ 应用 `MAX_FILE_SIZE` ↔ 前端。
  任一层小了都会出现"前端说可以、后端 413"。
- **PM2 跑 Vite 必须指 `node_modules/vite/bin/vite.js`**，不能直接写 `vite`。
- **dev 端口加 `--strictPort`**：否则端口被占时静默换端口，前端代理指向没人听的端口。
- **Nginx conf 用 `__PORT__` 占位符**渲染，不要手改生成物。
- 改端口要**三处同步**：`deploy/template.sh`、两个 `vite.config.ts`、Nginx conf（重渲染）。
  `rename.sh --ports` 已自动同步这三处，手工改时才需要自己对齐。
- 收尾 grep 一遍占位符：`grep -rn "TODO(部署端)" --exclude-dir=node_modules .`

---

## 一句话

1. **先 `bash deploy/rename.sh <slug> --yes`**，名字类别手改。
2. 再**换库、换账号、换 Redis 索引、换 bucket、看端口占用**。
3. **`DB_SYNCHRONIZE=false`**，schema 只走迁移。
4. **存储默认 `local`**，要对象存储再切 `s3` 并建独立私有 bucket。

> 上述每一条的「为什么」与踩坑记录，见 `坑与约束.md`；目录与编码契约见 `目录与编码规范.md`。
