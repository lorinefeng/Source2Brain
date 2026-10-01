# Source2Brain

让你正在用的 Agent，把收藏变成有出处、用得上的知识。

**v0.1.0 开发者预览。** 当前可执行采集聚焦小红书；media 为已有视频补充抽样帧与 OCR。OpenClaw 有历史参考部署，Hermes 使用同一知识协议与文件关键词检索；其他宿主提供官方接入资料，尚未实装验证。首发范围见 [发布定义](docs/release-scope.md)。

Source2Brain 的母项目负责能力索引、路由和知识协议：告诉 Agent 缺什么、哪个项目能补、如何安装调用、怎样验证输出。原子能力尽量复用上游项目。当前运行实现包括一份 Skill、一套 SourceArtifact 协议，以及采集、校验、去重和落盘脚本；知识默认保存在普通 Markdown 文件夹中，Obsidian 可选。

**基座与扩展：**Agent Reach 负责互联网采集；media 包组合 summarize 抽帧与 Tesseract.js 中英文 OCR，已完成首个真实扩展验收。MarkItDown 文档、Karakeep 收藏箱和 Anytype MCP 存储仍为候选适配。见[能力包索引](references/extensions/README.md)。由用户 Agent 按需选择、检测和安装，不默认装齐所有项目。

```text
你的 Agent → Source2Brain Skill → 按需求查能力索引
                     ↓              ↓
              Agent Reach      可选 media 等配方
                     └──────┬───────┘
                      原文与可追溯证据
                            ↓
                    普通 Markdown 目录
                            ↓
                 新会话检索 → 引用到当前工作
```

第一阶段聚焦 macOS 上的小红书视频闭环。已完成的验证与仍需人工完成的步骤见 [验收记录](docs/phase-1.md)。这不是任意 URL 解析器，也不是独立笔记 App。

## 从这里开始

将本仓库 README、[宿主接入索引](references/hosts/README.md) 和 [Skill](SKILL.md) 交给现有 Agent，让它检查执行环境和所需能力。首版还不是全平台一键安装器；扫码、模型和 ASR 配置按实际缺口处理。

| 使用方式 | 入口 | 验证范围 |
| --- | --- | --- |
| 已有 Hermes | [安装与检索](references/hosts/hermes.md) | [第二宿主验收](docs/hermes-validation.md) |
| OpenClaw + 微信常驻 | 下方参考部署与 [安装排障](docs/installation.md) | [第一阶段验收](docs/phase-1.md) |
| Codex / Claude Code / WorkBuddy / Qoder / DeepSeek Harness | [逐宿主官方资料](references/hosts/README.md) | 文档核对，未实装 |

需要完整 Skill 包时，从 GitHub Release 下载 `source2brain-skill-0.1.0.tar.gz` 并按 `SHA256SUMS` 校验，或在源码目录执行 `node scripts/package-skill.mjs`。必须携带 scripts、lib 和 references，不能只复制 SKILL.md。

## OpenClaw + 微信参考部署

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

## 按需补回已有视频的画面

media 是第一个可用能力包。它复用已保存视频，新增带时间戳的帧、原始 OCR 和逐字引用，独立保存为增强版本；不覆盖原来源或人工批注。

```sh
node scripts/brain.mjs doctor --pack media
# 用户确有画面文字需求且检测未就绪时，安装固定依赖（Node 24+）
node scripts/install-media.mjs
node scripts/brain.mjs enhance --pack media --artifact /知识库/Sources/来源ID/artifact.json --out /新的处理目录
```

随后由用户 Agent 按[完整配方](references/extensions/media.md)审阅、保存并调用宿主检索。当前实测范围是 macOS arm64 上已有小红书视频的抽样帧与 OCR；不等于全片视觉理解。真实结果与限制见 [media 验收记录](docs/media-validation.md)。

## 项目分工

本次部署将源码、安装经验和项目 `AGENTS.md` 放在开发 MacBook；运行时、浏览器、本地模型和知识库存放在常驻 Mac mini。其他用户也可以在同一台 Mac 上运行全部组件。

依赖角色与已验证版本见 [integrations.yaml](integrations.yaml)。母项目基座为 Skill、能力索引、协议、存储与验证、Agent Reach 采集路径。OpenClaw 和微信仅属于常驻参考部署；Hermes 不需要安装它们。FunASR 和本地 embedding 是参考实现，可用其他明确配置的实现替代。模型、素材、登录状态和密钥不会随项目分发。

首个扩展的经验已沉淀为“索引 → 检测复用 → 按需安装 → 调用 → 证据映射 → 保存与回读”的 Agent 配方。其他能力按真实需求逐项验收，再增加适配；跨 Agent 兼容服务于这条主线。详见[扩展架构](docs/extension-architecture.md)。

## 开发与反馈

运行 `npm test`、`npm run release:check`，通过后可用 `npm run release:build` 在忽略目录生成源码包、Skill 包与校验和。核心代码没有第三方 npm 运行依赖，基础安装不会下载 media。

[贡献说明](CONTRIBUTING.md) · [安全说明](SECURITY.md) · [版本记录](CHANGELOG.md) · [上游致谢](THIRD_PARTY_NOTICES.md) · [MIT 许可证](LICENSE)
