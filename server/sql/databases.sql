-- ============================================================================
-- 库与账号的**单一真源**（Single Source of Truth）
--
-- 位置：`server/sql/` 是手写 SQL 的家（同目录 rbac.sql 是 RBAC 表结构的迁移参考）。
--       脚本化迁移在 `src/core/database/migrations/`，不往这里放。
--
-- 本文件是「库叫什么、谁有权访问」的唯一权威定义。
-- 其它地方（docs / .env / 脚本）只能**引用**这里，不得各自发挥。
-- 「为什么这么分」「现在有哪些库」的台账在 `docs/库台账.md`。
--
-- 角色只有三个，命名按角色加后缀：
--   <项目>          dev   开发主库，含演示数据，可重建、不备份
--   <项目>_prod     prod  终态数据，只增不删、必须备份、迁移必须齐
--   <项目>_tmp      tmp   一次性：生成器验证 / e2e / 恢复演练，可随时 DROP
--
-- 铁律（R2）：**一库一账号，禁止跨库 GRANT**。
--   曾经的写法是单个 `template`@'%' 同时 GRANT template.* 与 template_prod.*，
--   等于 dev 进程的凭据能读写生产库 —— 这不是洁癖，是数据事故。
--
-- 执行顺序（一次）：
--   1. 在**托管 MySQL 的机器**上跑本文件（本地 ~/Docker/mysql 或部署端容器）
--   2. 把新密码填进 server/.env.dev / .env.test / .env.prod（见各文件 DB_USERNAME）
--   3. 重启 dev / prod 进程
--   顺序不能反：先改 .env 再跑本文件，进程会连不上库。
--
-- ⚠ 主机位必须写 '%'
--   MySQL 跑在 Docker 里，宿主端口映射后连接来源是 docker 网关（172.x），
--   不是 127.0.0.1。写 '127.0.0.1' 会得到 Access denied，误判成密码错。
--   真正的边界靠「一库一账号 + 只授本库」，不靠 host 限制。
--
-- ⚠ 派生新项目：把下面所有 template 替换成派生名后**追加**，不要改本项目的段落。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 库
-- ---------------------------------------------------------------------------
-- 字符集必须 utf8mb4_unicode_ci（与迁移里的表定义一致；排序规则不一致会在
-- JOIN 时抛 Illegal mix of collations）。

CREATE DATABASE IF NOT EXISTS `template`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE DATABASE IF NOT EXISTS `template_prod`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE DATABASE IF NOT EXISTS `template_tmp`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 注：原 `template_test` 已并入 `template_tmp`（同一角色，命名不重复造词）。
--     它是 tmp 类库，**不需要迁数据**：DROP 后由 scripts/db-reset.sh 重建 + 跑迁移。
--     DROP DATABASE IF EXISTS `template_test`;

-- ---------------------------------------------------------------------------
-- 2. 账号与授权（占位符由 scripts/db-apply.sh 在临时文件里渲染）
--
-- ⚠ **不要把真实密码写在这里。** 本文件要提交、随 SVN 分发给派生项目，
--    写进来等于把本机密码发给所有副本，而且 git 历史里擦不掉。
--    真密码只存在（已 gitignore 的）.env.dev / .env.test / .env.prod 里。
--    执行：bash scripts/db-apply.sh（读三份 .env → 渲染 → 执行 → 删临时文件）
--    手工执行时也必须先拷一份到 /tmp 改完再跑，改完把这份文件改回占位符。
--
-- ---------------------------------------------------------------------------

CREATE USER IF NOT EXISTS 'template_dev'@'%'  IDENTIFIED BY '<改我-dev>';
CREATE USER IF NOT EXISTS 'template_prod'@'%' IDENTIFIED BY '<改我-prod>';
CREATE USER IF NOT EXISTS 'template_tmp'@'%'  IDENTIFIED BY '<改我-tmp>';

-- ---------------------------------------------------------------------------
-- 3. 授权：只授自己的库，一行一个库，绝不合并
-- ---------------------------------------------------------------------------

GRANT ALL PRIVILEGES ON `template`.*      TO 'template_dev'@'%';
GRANT ALL PRIVILEGES ON `template_prod`.* TO 'template_prod'@'%';
GRANT ALL PRIVILEGES ON `template_tmp`.*  TO 'template_tmp'@'%';

FLUSH PRIVILEGES;

-- ---------------------------------------------------------------------------
-- 4. 回收旧共享账号
--
-- 旧模型：'template'@'%' 同时拥有 template.* 和 template_prod.*。
-- **必须等三处 .env 都切到新账号、dev/prod 都重启验证通过之后**，再执行：
--
--   -- 先查：还有谁在用？（应只剩已下线的进程）
--   SELECT user, host FROM mysql.user WHERE user = 'template';
--   SHOW GRANTS FOR 'template'@'%';
--   -- 再删
--   DROP USER IF EXISTS 'template'@'%';
--
-- 如果其它派生项目复用同一个账号，先各自切到 <派生名>_<角色> 再删，别一刀切。
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 5. 自检（应输出 3 行，每个账号只看到自己的库）
-- ---------------------------------------------------------------------------
-- SHOW GRANTS FOR 'template_dev'@'%';
-- SHOW GRANTS FOR 'template_prod'@'%';
-- SHOW GRANTS FOR 'template_tmp'@'%';
