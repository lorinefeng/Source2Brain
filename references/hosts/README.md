# 宿主接入与官方资料

核对日期：2026-10-01。先读当前宿主这一页，再执行 Source2Brain Skill；不要自动安装其他宿主。以下资料覆盖技能发现、运行权限、环境变量、检索和常见故障；“解决大部分配置问题”是文档目标，没有测量过 80% 的解决率。

| 宿主 | 首发状态 | 本项目说明 |
| --- | --- | --- |
| OpenClaw | 已有参考部署；历史采集、语义召回、微信重复收藏回复已验收 | [接入](../openclaw.md) |
| Hermes Agent | 本轮第二宿主；具体验证范围以仓库验收报告为准 | [安装与检索](hermes.md) |
| Codex | 官方资料已核对，未做用户安装验收 | [接入资料](codex.md) |
| Claude Code | 官方资料已核对，未实装 | [接入资料](claude-code.md) |
| WorkBuddy | 官方资料已核对，未制作市场连接器 | [接入资料](workbuddy.md) |
| Qoder | 官方资料已核对，未实装 | [接入资料](qoder.md) |
| DeepSeek Harness | 官方源码文档已核对，未实装 | [接入资料](deepseek-harness.md) |

## 共用排障顺序

1. 确认当前客户端、操作系统和实际执行机器。远程会话不能直接使用另一台机器的浏览器登录态。
2. 找到 `source2brain/SKILL.md`，确认 `scripts/brain.mjs`、`lib/`、`references/` 一起安装。只复制 SKILL.md 无法运行。
3. 在 Agent 的执行工具内检查 `node --version` 和脚本 `--help`。核心 Node 22+；media Node 24+。桌面终端可用不代表 Agent 的 PATH 正确。
4. 确认 `SOURCE2BRAIN_STORE` 或 `--store` 指向同一目录，目录权限允许所请求的读写。登录态与模型凭据留在原宿主。
5. 收藏时检查 Agent Reach/OpenCLI 和浏览器登录；只检索已有笔记无需登录平台。转写缺失时按采集路由配置已有 ASR。
6. 检索只读 `Sources`。宿主有明确配置的知识库语义检索就复用；否则执行 `brain.mjs search`，标注为文件关键词检索。宿主聊天记忆不等于知识库索引。
7. 涉及画面先运行 `doctor --pack media`，不要因没装 media 就阻断普通收藏。未找到画面事实的增强留在 Pending。
8. 验收分开记录：发现 Skill、运行 CLI、保存、重复保护、独立会话召回、平台采集、媒体、消息送达。不要把资料齐全写成全平台支持。

Source2Brain 当前没有 MCP Server，不要填写猜测的包名、地址或工具。各宿主 MCP 官方资料仅供将来确有工具注册需求时参考，现阶段优先 Skill + CLI。
