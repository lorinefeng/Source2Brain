# Hermes Agent 接入

复用已有 Hermes 和模型配置。官方入口：[Skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/)、[工具集](https://hermes-agent.nousresearch.com/docs/user-guide/features/tools/)、[配置](https://hermes-agent.nousresearch.com/docs/user-guide/configuration/)、[MCP](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference/)。核对日期：2026-10-01。

## 安装与运行

1. 用 `hermes --version`、`hermes profile --help` 确认当前安装。不要替换模型或导入 OpenClaw 配置。
2. 找到当前 profile 的 Hermes home。默认是 `~/.hermes`，命名 profile 通常在 `~/.hermes/profiles/<名称>`；尊重已有 `HERMES_HOME` 和 `-p` 选择。
3. 从仓库运行 `node scripts/package-skill.mjs` 得到完整 Skill 目录。复制到 `<Hermes home>/skills/source2brain`；已有同名目录先移到 skills 之外的备份位置，不合并覆盖，不让备份被当作另一个 Skill 加载。
4. 启动独立会话，显式加载 `hermes -s source2brain`，或通过 `skills_list`、`skill_view` 确认发现。Hermes 支持外部技能目录；同名优先级需要参考当前官方文档。
5. 为本次会话设置 Node PATH 和 `SOURCE2BRAIN_STORE`。仅启用所需工具集，例如 `terminal,file,skills`；先以 `hermes chat --help` 和当前工具列表为准。不要永久放开全局权限。

安装只新增 Skill 文件，不会自动安装 media、模型或启动网关。第一版仍需配置采集和 ASR，不能把 Skill 安装成功等同完整首次收藏成功。

## 保存、搜索与引用

按主 Skill 调用 capture、transcribe、validate、save；模型整理由 Hermes 当前模型完成。已有 SourceArtifact 可直接校验保存。

```sh
node /Skill实际路径/scripts/brain.mjs search --store ~/SecondBrain --query '产品化 反馈'
node /Skill实际路径/scripts/brain.mjs verify --store ~/SecondBrain
```

search 按空格分词、任一词字面匹配，返回 JSON 中的路径、行号、来源链接与摘录，不调用 embedding，也不调用 OpenClaw。读取匹配笔记和增强 JSON 后再回答；涉及画面时核对持久帧路径和秒数。不要把 Hermes 的会话搜索当作这里的知识库搜索。

在全新会话中只给自然语言问题，检查是否实际执行搜索、读取证据，再返回标题、链接、引用；同一会话记住答案不算通过。如果词汇不同没有命中，尝试少量同义词，而不是编造记忆。

## 常见故障与回退

| 症状 | 处理 |
| --- | --- |
| 找不到 Skill | 核对 profile、完整目录与 frontmatter；同名旧版本可能遮蔽外部目录；重开会话显式 `-s source2brain` |
| CLI 找不到 Node | 在同一执行环境检查 PATH，使用实际 Node 绝对路径；不要重装 Hermes |
| 搜不到 | 检查 store 是否一致；搜索关键词而非整句；核对是否在 Pending；查看 issues 和 verify |
| provider/model 错误 | 回到 Hermes 官方配置说明；只检查字段名和模型名，不输出凭据或完整配置 |
| media 未安装 | doctor 只报告缺失；有明确画面需求才执行固定配方 |

更新前备份旧 Skill；失败时恢复该目录。卸载只移走 `skills/source2brain` 和明确由本项目管理的独立配置，保留 `~/SecondBrain`、Hermes 原 profile、API 配置、共享模型与浏览器登录。演示用的彻底清理应先建立清单和可恢复备份，另行执行。
