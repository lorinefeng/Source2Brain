# Codex 官方接入资料

状态：资料核对，未做 Source2Brain 用户安装验收。日期：2026-10-01。

- [Skills 官方指南](https://learn.chatgpt.com/docs/build-skills)：完整 Skill 目录、发现路径、调用与刷新。
- [MCP 官方指南](https://learn.chatgpt.com/docs/extend/mcp)：只有确需 MCP 时使用；本项目目前未提供 MCP 服务。
- [权限与安全](https://developers.openai.com/codex/security/)：按当前本地／云端执行环境确定读写和网络权限。

建议由用户 Agent 先生成完整 Skill 包，放到用户 `~/.agents/skills/source2brain/` 或项目 `.agents/skills/source2brain/`，保留脚本和 references。显式选择 Skill，执行 CLI `--help`，核对知识库访问权限。不要把普通仓库根目录的 SKILL.md 自动当作已安装技能。

检索先复用已有、明确指向知识库的工具；缺少时按共用流程运行文件关键词 search。Codex 会话记忆不等于 Sources 索引。云端执行环境不会自动拥有本机小红书登录态；采集需在能访问对应浏览器的机器执行。

排障：Skill 未显示先检查路径、同名副本及是否禁用；脚本找不到先检查包是否完整；写库被拒先核对当前权限和目录，不建议永久关闭安全策略。完成本页不意味着 Windows/Linux 或云端采集已验证。
