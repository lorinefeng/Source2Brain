# Claude Code 安装与使用

状态：按官方文档编写的安装指引，尚未在本项目做实装验收。资料核对：2026-10-17（Claude Code 2.1.301，官方 [Skills](https://code.claude.com/docs/en/skills)、[权限](https://code.claude.com/docs/en/permissions)）。

## 复制给 Claude Code

在你平时用的目录启动 Claude Code，把下面这段发给它：

> 请为我安装 Source2Brain 完整 Skill：https://github.com/lorinefeng/Source2Brain 。先阅读 README、SKILL.md、docs/installation.md 和 references/hosts/claude-code.md。从最新 Release 下载完整 Skill 包并核对 SHA256SUMS，解压到 ~/.claude/skills/source2brain（目录里直接是 SKILL.md、scripts、lib、references）。已有同名目录先备份到 skills 目录之外。检测并复用已有 Node、Agent-Reach、OpenCLI 和本地转写能力，只补缺少的部分。知识保存到 ~/SecondBrain；按权限提示请求访问这个目录，不要跳过权限检查。平台登录由我本人在这台电脑的浏览器完成。装好后用 /source2brain 保存一条真实链接，再开新会话检索并引用出处，逐项说明通过和缺口。

## 安装步骤

### 1. 放置完整 Skill 包

| 位置 | 目录 | 用途 |
| --- | --- | --- |
| 个人 | `~/.claude/skills/source2brain/SKILL.md` | 推荐：本机所有项目可用（不含 Cowork 和云会话） |
| 项目 | `.claude/skills/source2brain/SKILL.md` | 只在该项目，可提交给团队 |
| 附加目录 | `--add-dir` 目录下的 `.claude/skills/` | 随附加目录加载 |

同名时企业级优先于个人，个人优先于项目。

```text
~/.claude/skills/source2brain/
├── SKILL.md
├── scripts/
├── lib/
├── references/
└── docs/ templates/ …
```

只复制 SKILL.md 无法运行。完整包来自 Release 的 `source2brain-skill-<版本>.tar.gz`（核对 `SHA256SUMS`），或在源码目录执行 `node scripts/package-skill.mjs`。

### 2. 确认 Skill 可见

在 `~/.claude/skills/` 或项目 `.claude/skills/` 里新增、修改、删除 Skill，当前会话内即可生效，无需重启。如果 skills 顶层目录是会话中途才创建的，运行 `/reload-skills`。

输入 `/source2brain` 显式调用；Claude 也会根据描述自动选用。Skill 被调用后，同一轮后续不会重新读取文件。

Claude Code 提供 `${CLAUDE_SKILL_DIR}` 表示 SKILL.md 所在目录。Source2Brain 的 SKILL.md 要求 Agent 从实际 SKILL.md 路径解析 `{baseDir}`，不依赖这个宿主专用变量。

### 3. 权限：知识目录与命令

默认只能访问启动目录。把知识库加入访问范围：

- 启动时：`claude --add-dir ~/SecondBrain`
- 会话中：`/add-dir ~/SecondBrain`
- 长期：在 `~/.claude/settings.json` 的 `permissions.additionalDirectories` 加入该路径

附加目录遵循同样的权限规则：读取不再询问，写入按当前权限模式询问。Bash 命令默认逐条确认，常用命令可在 settings 的 `permissions.allow` 中预先允许，例如 `"Bash(node *)"`。不要使用 `--dangerously-skip-permissions`。

在 Agent 的 Bash 里检查：

```sh
node --version
node ~/.claude/skills/source2brain/scripts/brain.mjs --help
```

核心 CLI 需要 Node 22+，media 需要 Node 24+。

### 4. 保存与新会话召回

用 `/source2brain` 发链接并保存。检索走文件关键词：

```sh
node ~/.claude/skills/source2brain/scripts/brain.mjs search --store ~/SecondBrain --query '动画 成本'
node ~/.claude/skills/source2brain/scripts/brain.mjs read --store ~/SecondBrain --source-id '<命中的来源ID>'
```

验收用新会话，不粘贴旧答案。给 Claude 加 Skill 不会自动创建知识库语义索引。

## 排障

1. **Skill 不出现**：检查目录与 SKILL.md 层级、同名覆盖、是否在 bare 模式；中途新建顶层目录要 `/reload-skills`。
2. **读写被拒**：知识库不在工作目录或附加目录里，按第 3 步加入。
3. **macOS 后台会话**：访问 `~/Desktop`、`~/Documents`、`~/Downloads` 可能需要单独授权；知识库放在家目录下的普通文件夹更省事。
4. **脚本找不到**：确认完整包解压，相对位置不变。

## 边界

本页是按官方资料整理的引导，未做本项目 Claude Code 实装验收；个人目录 Skill 不等于已安装到 Cowork 或云会话。完成真实保存和新会话召回后再更新 [验证矩阵](../../docs/v0.2-validation.md)。Source2Brain 没有 MCP Server，走 Skill + 本机 CLI。
