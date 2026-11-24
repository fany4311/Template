-- ============================================================
-- RBAC 三表扩展示例 SQL（sys_user / sys_role / sys_user_role）
-- 用途：生产环境手动迁移参考；开发环境旧版靠 synchronize=true 自动建表，
-- 现在三份 .env 均为 DB_SYNCHRONIZE=false，建表一律走 migrations（本文件仅作参考，不参与流程）。
-- 执行顺序：1) 建表  2) 数据迁移  3) 种子数据  4) 删旧列
-- ============================================================

-- ---------- 1. 建角色表 ----------
CREATE TABLE IF NOT EXISTS `sys_role` (
  `id` int NOT NULL AUTO_INCREMENT,
  `create_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `update_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `delete_time` datetime(6) DEFAULT NULL,
  `role_key` varchar(50) NOT NULL COMMENT '角色标识（如 admin/editor）',
  `role_name` varchar(50) NOT NULL COMMENT '角色名称（如 管理员）',
  `permissions` text NULL COMMENT '权限码列表（逗号分隔；*:*:* 表示超管）',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '状态：1正常 0禁用',
  UNIQUE INDEX `IDX_role_key` (`role_key`),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色表';

-- ---------- 2. 建用户-角色关联表 ----------
CREATE TABLE IF NOT EXISTS `sys_user_role` (
  `user_id` int NOT NULL COMMENT '用户ID',
  `role_id` int NOT NULL COMMENT '角色ID',
  PRIMARY KEY (`user_id`, `role_id`),
  KEY `IDX_user_role_role_id` (`role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户角色关联表';

-- ---------- 3. 数据迁移（一次性，改代码前执行）----------
-- 把 sys_user 旧列的 roles/permissions 迁移成 角色表 + 关联
-- （旧数据约定：roles 列含 'admin' 或 permissions 列含 '*:*:*' 的用户 → admin 角色）

-- 3.1 生成 admin 角色
INSERT INTO `sys_role` (`role_key`, `role_name`, `permissions`, `status`)
SELECT 'admin', '管理员', '*:*:*', 1
FROM `sys_user`
WHERE `roles` LIKE '%admin%' OR `permissions` LIKE '%*:*:*%'
LIMIT 1;

-- 3.2 建立关联
INSERT INTO `sys_user_role` (`user_id`, `role_id`)
SELECT u.`id`, r.`id`
FROM `sys_user` u
JOIN `sys_role` r ON r.`role_key` = 'admin'
WHERE u.`roles` LIKE '%admin%' OR u.`permissions` LIKE '%*:*:*%';

-- ---------- 4. 种子数据（示例角色，按需增删）----------
INSERT INTO `sys_role` (`role_key`, `role_name`, `permissions`, `status`) VALUES
('editor', '编辑', 'content:list,content:edit,content:add', 1),
('viewer', '只读', 'content:list', 1);

-- ---------- 5. 删除旧列（确认数据迁移无误后执行；开发环境 synchronize 也会自动删）----------
-- ALTER TABLE `sys_user` DROP COLUMN `roles`, DROP COLUMN `permissions`;

-- ---------- 6. 常用查询示例 ----------
-- 查某用户的角色
SELECT r.* FROM `sys_role` r
JOIN `sys_user_role` ur ON ur.`role_id` = r.`id`
WHERE ur.`user_id` = 1;

-- 查某用户合并后的权限码（去重）
SELECT GROUP_CONCAT(DISTINCT r.`permissions`) AS perms
FROM `sys_role` r
JOIN `sys_user_role` ur ON ur.`role_id` = r.`id`
WHERE ur.`user_id` = 1 AND r.`status` = 1;

-- 给用户挂角色
INSERT INTO `sys_user_role` (`user_id`, `role_id`) VALUES (1, 2);

-- 卸下角色
DELETE FROM `sys_user_role` WHERE `user_id` = 1 AND `role_id` = 2;
