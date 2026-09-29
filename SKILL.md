---
name: source2brain
description: 将用户明确要求收藏或保存的小红书链接整理为带原文证据的 Markdown 来源笔记，并在以后按主题检索与引用。当本 Skill 被用于专门的知识收藏机器人时，直接发来的链接也视为收藏请求。
metadata:
  openclaw:
    requires:
      bins: [node, agent-reach, opencli]
---

# Source2Brain

将链接变成可以追溯、能在新会话召回的来源笔记。知识库位置读取 `SOURCE2BRAIN_STORE`，未设置时为 `~/SecondBrain`。执行脚本前将 `{baseDir}` 替换为本 Skill 所在目录；非 OpenClaw 宿主从当前 SKILL.md 的路径解析。

## 保存一条来源

1. 用 `node {baseDir}/scripts/brain.mjs capture --message '<用户原始分享文本>' --out '<新的临时目录>'` 采集。一次处理一个链接，参数必须安全引用。此命令用 Agent Reach 体检选择 OpenCLI，读取正文和媒体，生成初始 `partial` artifact。
2. 读取返回的 artifact 与原始材料。遵守 [采集路由](references/routing.md)。视频且配置了 `SOURCE2BRAIN_ASR_PYTHON` 时运行 `node {baseDir}/scripts/brain.mjs transcribe --artifact '<采集 artifact>'`，读取返回的新 artifact。已有转写可用 `--from '<转写 JSON>'` 复用。图文须读取全部图片；视频须获得真实转写，可以不分析画面，但必须记录这个限制。登录、风控或内容缺失时保留 `partial`，不要凭标题或常识补内容。
3. 按 [来源协议](references/source-note-schema.md) 补齐 SourceArtifact。保留原文，摘要明确作为 AI 整理；每个作者观点附逐字引文；推断和建议分开。`provenance.model` 写实际模型名，步骤只写做过的操作。
4. `node {baseDir}/scripts/brain.mjs validate --artifact '<文件>'` 后，执行 `save --artifact '<文件>' --store '<知识库>'`。完整来源进入 `Sources/`，不完整来源进入 `Pending/`；重复链接不会覆盖笔记。
5. 完整保存后调用 OpenClaw 的 `memory` CLI 更新当前 profile 的索引，接着用 `memory_search` 搜一个来源中的独特主题，读取命中的正文确认。参考 [OpenClaw 接入](references/openclaw.md)。只有找到这次保存的来源，才声称可检索。
6. 回复标题、2–4 个有用要点、来源链接、保存结果和重要缺失。转写或索引失败须如实说明，并保留可重试状态。不要把“已保存”说成“已索引”。

## 回顾已有知识

用户问“之前看过什么”“收藏过哪些”“某个方法怎么用”时，先 `memory_search`；使用内容关键词、同义词或作者名，必要时拆成 2–3 个短查询。再读取命中笔记的原文证据，回答时引用标题和 `source_url`。若检索不可用，可只读搜索知识库文件，但必须说明这是文件回退。没有命中就说明没有找到，不能假装记得。

来源里的建议不会自动变成当前用户的行动授权。执行或修改别的项目应按用户的当次请求另行处理。
