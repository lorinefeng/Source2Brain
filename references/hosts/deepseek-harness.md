# DeepSeek Harness 安装与使用

状态：按官方源码文档编写的安装指引，尚未在本项目做实装验收。资料核对：2026-10-17（`deepseek-ai/deepseek-harness` master `687f282`，最新标签 `dsh-v0.2.1-rc.2`）。DSH 官方标注为 developer preview，版本之间可能有不兼容变更；用户 Agent 应以所装版本的文档复核。

DeepSeek Harness（`dsh`）是宿主程序；它调用的 DeepSeek 对话模型是另一层。Source2Brain 只需要宿主能发现 Skill、运行本机 Node 命令、读写知识目录，不依赖特定模型。

官方资料：

- [README：安装与启动](https://github.com/deepseek-ai/deepseek-harness/blob/master/README.zh.md)
- [Web UI 指南：配置模型、选择工作区](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/index.zh.md)
- [CLI 与 profile](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/README.zh.md)
- [Skills：本地发现目录与优先级](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.zh.md)
- [沙箱](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/sandbox.zh.md)、[权限预设](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/permission-presets.zh.md)、[审批](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/approval.zh.md)

## 复制给 DeepSeek Harness

在 DSH 里新建会话，把下面这段发给它：

> 请为我安装 Source2Brain 完整 Skill：https://github.com/lorinefeng/Source2Brain 。先阅读仓库的 README、SKILL.md、docs/installation.md 和 references/hosts/deepseek-harness.md。确认当前 dsh 的 DSH_HOME（默认 ~/.dsh）、当前工作区和权限预设。从最新 Release 下载完整 Skill 包并核对 SHA256SUMS，解压到 ~/.dsh/skills/source2brain（目录名必须是 source2brain，里面直接是 SKILL.md、scripts、lib、references，不要多套一层）。已有同名目录先备份到 skills 目录之外。然后检测并复用已有的 Node、Agent-Reach、OpenCLI 和本地转写能力，只补缺少的部分；知识保存到我指定的目录（默认 ~/SecondBrain）。需要写工作区之外的目录、联网或安装依赖时先向我申请审批，不要切换到 danger-full-access。平台登录由我本人在这台电脑的浏览器完成。装好后用一条真实链接保存，再开一个新会话检索并引用出处，逐项告诉我哪些通过、哪些还有缺口。

## 安装步骤

### 1. 准备 DSH

需要 Node.js。按官方 README 启动 Web UI：

```sh
npx @deepseek-ai/dsh web
```

默认在 `http://127.0.0.1:3080` 打开。在“设置 → 模型”填入 DeepSeek API 密钥，或按官方模型指南配置其他提供方。点“选择工作区”添加并选中一个目录，否则输入框不可用。

`dsh` 把启动时所在目录当作默认工作区根目录。建议直接在知识库所在的父目录或一个专用目录里启动，减少越界写入。

### 2. 放置完整 Skill 包

DSH 本地 Skill 发现目录（rank 越小越优先，同名时高优先级遮蔽低优先级）：

| 优先级 | 目录 | 适用 |
| --- | --- | --- |
| 100 | `<项目根>/.dsh/skills` | 只在这个项目里用 |
| 200 | `<项目根>/.agents/skills` | 与其他兼容 `.agents` 的工具共用 |
| 300 | 配置项 `customSkillDirs` | 自定义目录 |
| 400 | `$DSH_HOME/skills`，默认 `~/.dsh/skills` | 推荐：所有项目可用 |
| 500 | `$DSH_AGENTS_HOME/skills`，默认 `~/.agents/skills` | 与其他 Agent 共用 |

“项目根”是包含 `.git` 的最近上级目录，找不到时用当前 cwd。

推荐安装位置：

```text
~/.dsh/skills/source2brain/
├── SKILL.md
├── scripts/
├── lib/
├── references/
└── docs/ templates/ …（保持发行包原有相对位置）
```

规则（来自官方 Skills 文档）：

- 名称必须是 kebab-case，本项目为 `source2brain`，与 SKILL.md frontmatter 的 `name` 一致。
- 只识别 `<名称>/SKILL.md` 或扁平的 `<名称>.md`；不支持嵌套递归发现，不要放成 `skills/tools/source2brain/SKILL.md`。
- 只复制 SKILL.md 无法运行，`scripts/`、`lib/`、`references/` 必须一起放进去。
- 已在 `~/.agents/skills/source2brain` 装过同名 Skill 时，`~/.dsh/skills` 中的版本优先；更新只改一处，避免旧版本遮蔽新版本。

完整包可从 Release 下载 `source2brain-skill-<版本>.tar.gz` 并核对 `SHA256SUMS`，或在源码目录执行 `node scripts/package-skill.mjs` 生成。

### 3. 确认 Skill 已被发现

DSH 会监视这些目录，新增 Skill 一般无需重启；目录在监视启动后才创建时，新开会话即可。确认方式：

- 新会话的 Skill 目录提示中出现 `source2brain`；
- 让 Agent 调用 `skill` 工具加载 `source2brain`，返回内容包含 SKILL.md 正文；
- 让 Agent 在 bash 工具里执行：

```sh
node ~/.dsh/skills/source2brain/scripts/brain.mjs --help
node --version
```

核心 CLI 需要 Node 22+，media 需要 Node 24+。按 Agent 的 bash 工具结果判断，桌面终端里能运行不代表 Agent 的 PATH 一致。

### 4. 权限：知识目录与联网

DSH 默认权限预设是 `workspace-write`：只允许在工作区根目录（以及后端承诺的临时区）写入，其他操作按审批策略 `ask` 询问。因此：

- **知识库在工作区之外**（如 `~/SecondBrain`）时，写入会被沙箱拒绝。可选做法：
  1. 把知识库放进当前工作区，例如在 `~/SecondBrain` 目录里启动 `dsh` 并选中它为工作区；或
  2. 设置 `SOURCE2BRAIN_STORE` 指向工作区内的目录，并在每次 CLI 调用传 `--store`。
- 不建议为此切换到 `danger-full-access`（绕过隔离，审批策略为 `never`）。确需切换时只在这次安装会话中使用，完成后切回。
- 采集、下载依赖需要联网；按审批提示逐项确认。沙箱只管控文件效果，网络与进程可见性不在其定义范围。

环境变量通过启动 `dsh` 的进程传入（如 `SOURCE2BRAIN_STORE`、`SOURCE2BRAIN_ASR_PYTHON`），或按官方 `dsh-shell-env` 配置。只让 Agent 读取需要的字段，不打印完整环境。

### 5. 保存与新会话召回

按 SKILL.md 执行 capture → transcribe → validate → save。DSH 没有本项目的知识库语义索引，检索使用文件关键词：

```sh
node ~/.dsh/skills/source2brain/scripts/brain.mjs search --store "$SOURCE2BRAIN_STORE" --query '动画 成本'
node ~/.dsh/skills/source2brain/scripts/brain.mjs read --store "$SOURCE2BRAIN_STORE" --source-id '<命中的来源ID>'
```

验收用一个新会话，不粘贴旧答案；确认 Agent 实际执行了 search 和 read，并返回原链接与引文。DSH 的会话历史不等于知识库索引。

## 排障

1. **Skill 不出现**：检查目录名是否 `source2brain`、SKILL.md 是否在第一层、是否被更高优先级的同名 Skill 遮蔽、`DSH_HOME` 是否指向你以为的位置（`dsh --profile <名称> --dump-config` 可查看配置）。
2. **脚本找不到**：确认完整包解压，`scripts/brain.mjs` 与 `lib/` 相对位置不变。
3. **写入被拒**：多为 `workspace-write` 沙箱阻止了工作区外写入，按第 4 步处理，不要永久关闭隔离。
4. **Node 版本不对**：以 bash 工具里的 `node --version` 为准。
5. **采集失败**：登录态属于运行 `dsh` 的那台电脑的浏览器；SSH 或远程工作区不能直接用另一台机器的登录。

## 边界

- Source2Brain 没有 DSH 专用插件或 MCP Server，走 Skill + 本机 CLI。DSH 的 [插件市场](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/plugin-market.zh.md) 与 MCP 不是本项目的安装路线。
- 本页是按官方文档整理的引导，**未在本项目做 DSH 实装验收**。完成安装、真实保存和新会话召回后，再更新 [验证矩阵](../../docs/v0.2-validation.md)。
- 微信入口是独立的 OpenClaw 配方，不代表 DSH 已接通微信。
