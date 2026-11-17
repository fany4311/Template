# CONTEXT — 执行状态快照

> **AI 维护**。开工前先读；**收尾必须覆盖写**（不是追加），完成项清出去进 `docs/log/`。
> 只写「现在/下一步」；历史一律去 `docs/log/`。随时带「最后更新」时间戳。

**最后更新**：2026-11-17

---

## 现在做什么

- 由通用底座派生的 **Template** 副本已就位；身份标识已统一为 `template`，不含 SVN 元数据。
- 尚未绑定任何业务、部署环境与真实密钥。

## 下一步

- [ ] 按 `docs/init.md` 逐项替换：库名 / 账号 / Redis 索引 / bucket / 端口 / PM2 名 / 站点名 / 目录 / token key。
- [ ] 三份 `server/.env.*` 填自己的连接信息，确认 `DB_SYNCHRONIZE=false`。
- [ ] 三端各 `pnpm install` → `migration:run`（dev/test）→ `authz:sync` → 建首个超管。
- [ ] 按需保留或移除 `hazard` 示例业务（底座用它验证过一条业务闭环）。

## 阻塞

- 无。

## 验证台账

- 本次仅做身份替换与复制，未重新安装依赖 / 未跑构建与测试；首次使用前按 `docs/init.md` §4 验收。
