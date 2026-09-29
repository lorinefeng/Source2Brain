# Source2Brain

把一条小红书链接发给微信里的 Agent，让它读懂内容、留下出处，并在以后需要时找回来。

项目本体是一份 Skill、一套 SourceArtifact 协议，以及负责采集、校验、去重和落盘的小脚本。知识保存在普通 Markdown 文件夹中，Obsidian 可选。

```text
微信消息 → OpenClaw → Source2Brain Skill
                       ↓
               Agent Reach / OpenCLI
                       ↓
               正文 + 媒体 + 本地转写
                       ↓
              SourceArtifact + 原文证据
                       ↓
              ~/SecondBrain/Sources/
                       ↓
              OpenClaw 语义/关键词召回
```

第一阶段聚焦 macOS 上的小红书视频闭环。已完成的验证与仍需人工完成的步骤见 [验收记录](docs/phase-1.md)。这不是任意 URL 解析器，也不是独立笔记 App。

## 开始使用

在运行 ClawBot 的 Mac 上取得本仓库，运行：

```sh
bash scripts/bootstrap-macos.sh
```

脚本安装独立 Node/OpenClaw 运行时与 Skill，不依赖全局 npm，不改动其他 OpenClaw profile。接着按 [安装与排障](docs/installation.md) 配置对话模型、登录小红书和微信。平台扫码仍需本人完成。

已经有 Node 时，可先验证存储核心（不需要模型或微信）：

```sh
npm test
node scripts/brain.mjs init --store ~/SecondBrain
node scripts/brain.mjs --help
```

## 笔记保留什么

- 原 URL、作者、已知发布时间、采集时间和实际处理方式。
- 提取原文与真实转写，AI 摘要和作者观点的逐字证据。
- 明确分开的模型推断、待尝试行动与覆盖限制。

同一平台 ID 只保存一份来源；重复发送保留人工编辑。内容变化返回冲突。不完整采集进入 `Pending/`，完整来源才进入 `Sources/`。视频只转写、不分析画面时会明确标注。

## 项目分工

本次部署将源码、安装经验和项目 `AGENTS.md` 放在开发 MacBook；运行时、浏览器、本地模型和知识库存放在常驻 Mac mini。其他用户也可以在同一台 Mac 上运行全部组件。

依赖角色与已验证版本见 [integrations.yaml](integrations.yaml)。基础层为 OpenClaw、微信插件、Agent Reach/OpenCLI、Markdown 存储。FunASR 和本地 embedding 是本次部署选用的能力实现，可用其他有明确配置的服务替代。模型、素材、登录状态和密钥不会随项目分发。

后续阶段再完善安装器、其他平台和媒体/文档扩展；演示动画排在真实链路之后。
