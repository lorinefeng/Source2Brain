# Codex 安装与使用

状态：按官方文档编写的安装指引，尚未在本项目做用户安装验收。资料核对：2026-10-17（Codex CLI 0.136.0 的 `--help`，官方 [Skills 指南](https://learn.chatgpt.com/docs/build-skills)、[安全与审批](https://developers.openai.com/codex/security/)）。

## 复制给 Codex

在你平时用的目录启动 Codex（CLI、IDE 扩展或桌面 App 的本地会话），把下面这段发给它：

> 请为我安装 Source2Brain 完整 Skill：https://github.com/lorinefeng/Source2Brain 。先阅读 README、SKILL.md、docs/installation.md 和 references/hosts/codex.md。从最新 Release 下载完整 Skill 包并核对 SHA256SUMS，解压到 ~/.agents/skills/source2brain（目录里直接是 SKILL.md、scripts、lib、references）。已有同名目录先备份到 skills 目录之外。检测并复用已有 Node、Agent-Reach、OpenCLI 和本地转写能力，只补缺少的部分。知识保存到 ~/SecondBrain；写这个目录、联网或安装依赖前先按审批询问我，不要关闭沙箱。平台登录由我本人在这台电脑的浏览器完成。装好后提醒我重启 Codex，用 $source2brain 保存一条真实链接，再开新会话检索并引用出处，逐项说明通过和缺口。

## 安装步骤

### 1. 放置完整 Skill 包

Codex 从以下位置读取本地 Skill：

| 范围 | 目录 | 用途 |
| --- | --- | --- |
| REPO | `$CWD/.agents/skills`，以及向上直到仓库根的每一级 `.agents/skills` | 只在某个项目里用 |
| USER | `$HOME/.agents/skills` | 推荐：所有目录可用 |
| ADMIN | `/etc/codex/skills` | 机器级共享 |
| SYSTEM | Codex 内置 | 如 skill-creator、skill-installer |

同名 Skill 不会合并，两份都可能出现在选择器里。更新时只保留一份，避免选到旧版本。

推荐位置：

```text
~/.agents/skills/source2brain/
├── SKILL.md
├── scripts/
├── lib/
├── references/
└── docs/ templates/ …
```

只复制 SKILL.md 无法运行。完整包来自 Release 的 `source2brain-skill-<版本>.tar.gz`（核对 `SHA256SUMS`），或在源码目录执行 `node scripts/package-skill.mjs`。仓库根目录里的 SKILL.md 不等于已安装的 Skill。

`~/.agents/skills` 与 DeepSeek Harness 的 user-agents 目录相同；两边都装时只需一份。

### 2. 确认 Skill 可见

Codex 会自动检测 Skill 变化；没出现就重启 Codex。在 CLI 或 IDE 扩展里运行 `/skills` 查看列表，或输入 `$` 选择 `source2brain` 显式调用。

想暂时停用而不删除，在 `~/.codex/config.toml` 加：

```toml
[[skills.config]]
path = "/Users/<你>/.agents/skills/source2brain/SKILL.md"
enabled = false
```

改 config.toml 后需要重启 Codex。

### 3. 权限：知识目录与联网

Codex 在沙箱里执行模型生成的命令。工作区之外的知识目录需要显式加为可写：

```sh
codex --add-dir ~/SecondBrain
```

`--add-dir` 让该目录与主工作区一起可写。也可以直接在 `~/SecondBrain` 里启动 Codex。采集和安装依赖需要联网，按审批逐项确认；不要用 `--dangerously-bypass-approvals-and-sandbox`。

在 Agent 的命令里检查：

```sh
node --version
node ~/.agents/skills/source2brain/scripts/brain.mjs --help
```

核心 CLI 需要 Node 22+，media 需要 Node 24+。以 Codex 执行结果为准，桌面终端能运行不代表沙箱内一致。

### 4. 保存与新会话召回

用 `$source2brain` 发链接，按 SKILL.md 执行保存。检索走文件关键词：

```sh
node ~/.agents/skills/source2brain/scripts/brain.mjs search --store ~/SecondBrain --query '动画 成本'
node ~/.agents/skills/source2brain/scripts/brain.mjs read --store ~/SecondBrain --source-id '<命中的来源ID>'
```

验收用新会话，不粘贴旧答案。Codex 会话记忆不等于 Sources 索引。

## 排障

1. **Skill 不出现**：重启 Codex；检查目录名、SKILL.md 是否在第一层、是否被 `[[skills.config]]` 禁用、是否有同名副本。
2. **写入被拒**：知识目录不在工作区，按第 3 步加 `--add-dir`，不要永久关闭沙箱。
3. **脚本找不到**：确认完整包解压，`scripts/` 与 `lib/` 相对位置不变。
4. **云端任务**：Codex 云端环境没有你本机浏览器的小红书/抖音登录态，采集必须在能访问对应浏览器的机器执行。

## 边界

本页是按官方资料整理的引导，未做本项目 Codex 实装验收；完成真实保存和新会话召回后再更新 [验证矩阵](../../docs/v0.2-validation.md)。Source2Brain 目前没有 MCP Server，走 Skill + 本机 CLI。微信入口是独立的 OpenClaw 配方。
