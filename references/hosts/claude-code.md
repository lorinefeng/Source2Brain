# Claude Code 官方接入资料

状态：资料核对，未实装。日期：2026-10-01。

- [Skills](https://code.claude.com/docs/en/skills)：技能目录、触发、作用域与同名规则。
- [权限](https://code.claude.com/docs/en/permissions)：工具权限与附加目录。
- [MCP](https://code.claude.com/docs/en/mcp)：工具接入参考，本项目暂不需要。

本地 Claude Code 可将完整包放在 `~/.claude/skills/source2brain/` 或项目 `.claude/skills/source2brain/`，用 `/source2brain` 明确调用。让 Agent 从实际 SKILL.md 位置解析脚本根目录。官方提供 `${CLAUDE_SKILL_DIR}`，无需把这个宿主专用变量写进所有宿主共用命令。

在执行工具内检测 Node、采集工具、知识库权限，再按共用流程保存与文件关键词检索。知识库位于项目外时依官方权限机制授权该目录。个人目录 Skill 不等于已安装到 Cowork 或云会话。

故障顺序：当前客户端形态 → 技能作用域和重名 → 完整资源目录 → 实际 cwd/PATH → 知识库权限 → 采集登录／ASR → 回读。只给 Claude 增加 Skill 不会自动创建知识库语义索引。
