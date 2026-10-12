# Hermes Agent 接入

复用已有 Hermes 与模型，不安装 OpenClaw。官方入口：[Skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/)、[工具集](https://hermes-agent.nousresearch.com/docs/user-guide/features/tools/)、[配置](https://hermes-agent.nousresearch.com/docs/user-guide/configuration/)。资料核对：2026-10-07；实测范围见 [验证矩阵](../../docs/v0.2-validation.md)。

## 复制给 Hermes

> 请在当前 Hermes profile 安装 Source2Brain 完整 Skill，先阅读本项目 SKILL.md 和安装指南。保留我的模型与原配置，先检测和复用已有 Node、Agent Reach/OpenCLI、浏览器登录与本地 ASR，按本次收藏需求补缺失工具。知识默认放 ~/SecondBrain；只把完整来源保存到 Sources。更新已有 Skill 前在 skills 目录之外备份。完成后确认 Skill 可见，用一条真实来源完成保存，再开独立新会话执行本项目 search 并读取出处，分别记录能力和未通过项。不要因为我使用 Hermes 就安装 OpenClaw；微信入口只有我选择时才按可选配方配置。

## 完整包安装

1. 运行 `hermes --version`、`hermes profile --help`，确认实际执行机器和当前 profile。保留已有 `HERMES_HOME` 与 `-p` 选择。
2. 使用完整 Skill 发行包，或在源码/完整包执行 `node scripts/package-skill.mjs`。将输出整个目录复制到当前 Hermes home 的 `skills/source2brain`。默认 home 通常是 `~/.hermes`，命名 profile 按实际配置确认。
3. 已有同名目录先备份到 skills 之外；不合并覆盖，不让备份成为第二份 Skill。
4. 新开会话，使用 `hermes -s source2brain` 或 `skills_list`、`skill_view` 确认。官方规定项目、local、create_dir、external_dirs 有优先级；同名旧目录可能遮蔽新版本。
5. 按 [安装指南](../../docs/installation.md) 检测实际执行环境，并设置 `SOURCE2BRAIN_STORE`、ASR 与 media 路径。仅启用本任务需要的命令、文件和 Skill 工具，不改全局模型。

不要只用 SKILL.md URL 安装代替完整包。Hermes 的 URL 导入仅取明确引用且在允许目录中的资源，不保证本项目 `lib/` 依赖完整；导入成功不等于 CLI 能运行。此处使用完整目录避免该差异。

## 保存和新会话召回

模型整理使用当前 Hermes 模型；按主 Skill 执行 capture、transcribe、validate、save，画面需求按 media 配方处理。

```sh
node /Skill实际路径/scripts/brain.mjs search --store "$HOME/SecondBrain" --query '产品化 反馈'
node /Skill实际路径/scripts/brain.mjs read --store "$HOME/SecondBrain" --source-id '<命中的来源ID>'
node /Skill实际路径/scripts/brain.mjs verify --store "$HOME/SecondBrain"
```

search 是文件关键词检索，按空格分词、任一词字面匹配，不调用 embedding 或 OpenClaw。自然语言问题可由 Agent 转成短关键词；空结果允许尝试少量同义词，不能编造记忆。只接受当前 Sources 的命中，必须用统一 read 回读有效事实、原证据、时间戳与已有勘误；检查 issues，不直接复用旧增强 JSON 的摘要或已撤回、待定的原断言。Hermes 的聊天会话搜索不等于本项目知识库检索。

验收使用独立新会话，不粘贴旧正文、路径、链接或答案；检查 Agent 实际执行搜索、读取证据。安装、真实采集、媒体、新会话、微信是不同层级。Hermes 资料页不声称拥有本项目已验证微信通道。

## 恢复

Skill 不可见先检查 profile、完整目录、同名遮蔽与 frontmatter。Node 不可见先核对 Agent PATH，不重装 Hermes。搜索失败检查 store、Pending、issues 与 verify。

更新失败恢复备份目录。卸载只移走本项目 Skill 与明确创建的独立配置，保留知识库、Hermes 原 profile、模型凭据、共享模型及浏览器登录。
