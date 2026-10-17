# 宿主接入与官方资料

> 下文首发验证为历史记录。当前 OpenClaw/Hermes 分层验证与微信新来源结果见 [v0.2 验证矩阵](../../docs/v0.2-validation.md)。常驻链接整理推荐原生支持多模态的 Agent；只支持文本的主模型可使用用户明确指定的独立视觉工具。

核对日期：2026-10-07。候选版本的分层实测结果见 [验证矩阵](../../docs/v0.2-validation.md)，新用户先看 [两条安装入口](../../docs/installation.md)。先读当前宿主这一页，再执行 Source2Brain Skill；不要自动安装其他宿主。以下资料覆盖技能发现、运行权限、环境变量、检索和常见故障；“解决大部分配置问题”是文档目标，没有测量过 80% 的解决率。

每页都有一段「复制给该 Agent」的安装提示词、完整包放置目录、确认方法、知识目录权限和排障顺序。用户把仓库链接发给自己在用的 Agent，它按对应页面安装即可。

| 宿主 | 状态 | 推荐安装目录 | 本项目说明 |
| --- | --- | --- | --- |
| OpenClaw | 已有参考部署；采集、语义召回、微信收发已验收 | 当前 profile 的 workspace skills | [接入](../openclaw.md) |
| Hermes Agent | 已实测 Skill 安装与指定库回读 | `$HERMES_HOME/skills/source2brain` | [安装与检索](hermes.md) |
| Codex | 官方资料指引（2026-10-17），未实装验收 | `~/.agents/skills/source2brain` | [安装指引](codex.md) |
| Claude Code | 官方资料指引（2026-10-17），未实装验收 | `~/.claude/skills/source2brain` | [安装指引](claude-code.md) |
| WorkBuddy | 官方本地导入指引，未实装验收 | 技能 → 添加技能 → 上传技能 | [安装指引](workbuddy.md) |
| DeepSeek Harness | 官方源码文档指引（2026-10-17），未实装验收 | `~/.dsh/skills/source2brain` | [安装指引](deepseek-harness.md) |
| Qoder | 官方资料已核对，未实装 | 见页面 | [接入资料](qoder.md) |

「指引」表示按官方文档写好了可执行步骤；「已验收」才表示本项目在该宿主跑通过真实保存与新会话召回。

## 共用排障顺序

1. 确认当前客户端、操作系统和实际执行机器。远程会话不能直接使用另一台机器的浏览器登录态。
2. 找到 `source2brain/SKILL.md`，确认 `scripts/brain.mjs`、`lib/`、`references/`、安装资料和模板一起安装。只复制 SKILL.md 无法运行。
3. 在 Agent 的执行工具内检查 `node --version` 和脚本 `--help`。核心 Node 22+；media Node 24+。桌面终端可用不代表 Agent 的 PATH 正确。
4. 确认 `SOURCE2BRAIN_STORE` 或 `--store` 指向同一目录，目录权限允许所请求的读写。登录态与模型凭据留在原宿主。
5. 收藏时检查 Agent Reach/OpenCLI 和浏览器登录；只检索已有笔记无需登录平台。转写缺失时按 [ASR 配方](../asr/README.md) 检查已有环境或显式安装。
6. 检索只读 `Sources`。宿主有明确配置的知识库语义检索就复用；否则执行 `brain.mjs search`，标注为文件关键词检索。宿主聊天记忆不等于知识库索引。
7. 涉及画面先运行 `doctor --pack media`，不要因没装 media 就阻断普通收藏。未找到画面事实的增强留在 Pending。
8. 验收分开记录：发现 Skill、运行 CLI、保存、重复保护、独立会话召回、平台采集、媒体、消息送达。不要把资料齐全写成全平台支持。

Source2Brain 当前没有 MCP Server，不要填写猜测的包名、地址或工具。各宿主 MCP 官方资料仅供将来确有工具注册需求时参考，现阶段优先 Skill + CLI。
