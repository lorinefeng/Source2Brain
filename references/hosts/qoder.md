# Qoder 官方接入资料

状态：资料核对，未实装。日期：2026-10-01。

- [Skills](https://docs.qoder.com/extensions/skills)：IDE 与 CLI 技能机制、目录与手动调用。
- [CLI MCP](https://docs.qoder.com/cli/mcp-reference)：仅作未来工具接入参考。
- [文档总索引](https://docs.qoder.com/llms.txt)：按当前客户端查权限、终端、代理排障。

官方列出的目录为 `~/.qoder/skills/source2brain/` 或项目 `.qoder/skills/source2brain/`。复制完整包；项目同名技能优先。按官方说明重启并用 `/` 查看，显式调用 `/source2brain`。

先在 Agent 执行工具里确认 Node 和知识库路径；再使用共用 Skill 与 CLI。项目代码索引不等于 SecondBrain 来源检索，默认采用 Sources 文件关键词 search。若终端命令异常，先检查执行环境、PATH、权限和代理，不默认重装。

云任务、本地 IDE、CLI 与 Windows 是不同验收组合；本页不声明这些组合已可用。
