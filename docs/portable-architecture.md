# 跨 Agent 架构与实施建议

> 定位修正：本文只保留宿主兼容的技术讨论。Source2Brain 的主线是索引并按需编排第三方开源能力包，见[扩展架构](extension-architecture.md)。此前把宿主适配当作下一阶段主线的排序已撤回；本文不代表已批准的实施排期。

原始设计核对日期：2026-09-29。2026-10-01 已按用户选择验证 Hermes 的限定接入，见 [Hermes 验收](hermes-validation.md) 和 [当前宿主资料](../references/hosts/README.md)。以下架构拆分仍是历史讨论，不表示已实施通用安装器、MCP 或全部宿主兼容。

用户已选择：**先接入粉丝现有 Agent，直接收藏和检索**。微信全天在线作为可选部署方案；现有 Mac mini 部署继续使用。

## 产品边界

Source2Brain 提供可迁移的知识工作流：采集来源、保留证据、整理知识、可靠保存、按需找回。用户使用自己熟悉的 Agent 负责对话、理解和工具编排，继续使用该 Agent 已配置的模型。

必须区分四个选择：

- Agent 宿主：Codex、Claude Code、WorkBuddy、Qoder、Hermes、DeepSeek Harness、OpenClaw。
- 对话模型：由宿主提供。DeepSeek Harness 是实际存在的独立产品，不能与 DeepSeek 模型混为一谈。
- 内容来源与处理器：小红书、未来的网页/视频/文档，以及 ASR、OCR、视觉等能力。
- 运行位置与消息入口：本机按需，或常驻主机加微信等通道。

支持某个 Agent，不等于支持其所有云端、移动端、沙箱和操作系统形态。接入认证应记录到具体客户端版本、系统和执行环境。

## 现有基座与耦合点

| 模块 | 现状 | 下一步 |
| --- | --- | --- |
| `lib/store.mjs` | 普通 Markdown、artifact、receipt；去重、原子发布、不覆盖人工编辑 | 保留为共享实现；增加稳定的 read/list 接口 |
| `lib/artifact.mjs` | 证据引文检查、完整性分级、来源渲染 | 当前校验与 ID 仍写死小红书；扩展内容平台时再抽出来源身份适配，兼容旧 ID |
| `lib/capture.mjs` | Agent Reach 体检 + OpenCLI 小红书采集 | 作为第一种 source adapter；抽象能力接口，但不同时承诺所有平台 |
| `scripts/transcribe-local.py` | 复用本机 FunASR 与已缓存模型 | 作为一种 ASR adapter；可选本地/远程实现，独立检测配置 |
| `SKILL.md` | 工作流大部分通用，保存后强制调用 OpenClaw memory | 改为共用 CLI/MCP 契约；宿主专属说明外置 |
| `scripts/brain.mjs` | capture/transcribe/validate/save/verify/doctor | 增加 read/search/index/capabilities；现有命令并不包含这些接口 |
| 安装脚本与配置器 | macOS + OpenClaw profile + 模型配置 | 保留为 OpenClaw 部署配方；另做中立安装器 |
| `integrations.yaml` | 当前部署把 OpenClaw/微信写为 required | 下一阶段按能力/部署配方声明依赖，避免所有用户被迫安装 |

## 推荐实现：一个核心，两种调用方式

**共享核心 + 标准 Skill + CLI；按需增加薄 MCP 包装；宿主差异只进入安装与能力适配。**

Skill 指导编排和证据规范；核心负责可确定执行的校验、落盘和检索。CLI 与 MCP 调用同一份核心函数，不能各维护一套采集/存储实现。MCP 是工具接入协议，不自动提供模型、浏览器登录、任务常驻或知识库。

建议的目录边界（尚未实施）：

```text
core/                  # 来源协议、证据校验、存储、查询契约
adapters/
  sources/             # xiaohongshu；后续才增加其他平台
  media/               # funasr；可选 OCR、字幕、文档处理
  retrieval/           # 全文基线；上游语义检索；OpenClaw memory 桥接
interfaces/
  cli/                 # 所有宿主可共享
  mcp/                 # 同一核心的工具包装
skills/source2brain/   # 一份中立工作流
installers/hosts/      # 发现路径、配置合并、备份、卸载
recipes/               # 本机按需；OpenClaw + 微信常驻等
tests/conformance/     # 所有宿主使用同一套验收材料与断言
```

这只是职责边界，不要求立即拆包或迁移所有目录。先使同一套代码在第二个宿主跑通，再确定稳定的物理目录。

## 召回应独立于聊天记忆

Markdown 是唯一权威知识存储。Agent 的会话历史、用户偏好记忆以及向量索引都不能替代来源文件。任何索引都应可从 Sources 重建；Pending 默认排除。

最低公共契约建议为 `search(query)` 和 `read(source_id)`，返回来源 ID、标题、原链接、证据片段和当前覆盖限制。先补不需要额外模型的全文检索，再接可替换的语义后端。中文分词/切分必须用真实查询验证，不能只因 SQLite FTS 可用就宣称中文召回合格。

保留现有 OpenClaw memory 作为可用后端；给其他宿主选择成熟的本地检索工具或一个可重建的轻量索引。是否启用 embedding 是能力选项。暂不建设独立云 RAG 平台。

跨宿主的关键验收是：A Agent 保存，关闭该会话；B Agent 打开同一知识库，以无标题、无 URL 的自然语言找回出处。B 不需要复制 A 的聊天记录。文件读取兜底与语义检索应明确区分。

## 各平台的现实接入路径

以下“可行”仅指官方接口支持，不代表 Source2Brain 已实测。只有 OpenClaw 是本项目当前已部署的宿主。

| 宿主 | 官方能力依据 | 推荐入口 | 需验证的差异 |
| --- | --- | --- | --- |
| Codex 本地客户端 | [OpenAI Docs：Skills](https://learn.chatgpt.com/docs/build-skills)、[MCP](https://learn.chatgpt.com/docs/extend/mcp) | 开发时 Skill + CLI；分发时可包装插件与 MCP | `.agents/skills` 的发现、执行权限、知识库目录访问；云端并不自动拥有本机浏览器 |
| Claude Code | [Skills](https://code.claude.com/docs/en/skills)、[MCP](https://code.claude.com/docs/en/mcp) | 同一 Skill + CLI；需要工具注册时用本地 MCP | `.claude/skills`、目录授权、进程环境；不把 Claude 专属 frontmatter 写入通用流程 |
| WorkBuddy | [连接器官方规范](https://open.workbuddy.cn/docs/connector) | 首选验证本地 MCP + Skill；成熟跨平台 CLI 后可选 CLI 连接器 | 连接器元信息、托管运行时与版本字段；浏览器/Python 能力仍需单独检测 |
| Qoder | [Skills](https://docs.qoder.com/extensions/skills)、[MCP](https://docs.qoder.com/cli/mcp-reference) | Skill + CLI 或同一个 MCP | IDE/CLI 都有 Skills；`.qoder/skills` 和运行目录、权限、Windows 实测 |
| Hermes Agent | [Skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/)、[MCP](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference/) | 同一 Skill + CLI / MCP | 当前 profile 的技能目录、环境变量和工具集；内置记忆不等于自动索引知识库 |
| DeepSeek Harness | [官方产品页](https://deepseek.com/harness/en/)、[Skills 源码文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.zh.md)、[MCP 源码文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/mcp.zh.md) | 先 Skill + CLI / MCP，暂不写专用 Cordis 插件 | `.dsh/skills` / `.agents/skills`；开发者预览接口仍在演进 |

WorkBuddy 官方连接器要求一个连接器选择一种接入方案，不能把 CLI 与 MCP 方案混装在同一连接器。其 MCP 文档建议短时间响应，长转写应交给可查询的作业。DeepSeek Harness 当前 MCP 文档未支持 task-based execution，所以不能把标准 MCP Tasks 当作所有宿主的必要条件。

## 不同调用方式的取舍

| 方案 | 优点 | 代价 | 本项目选择 |
| --- | --- | --- | --- |
| 只有 Skill + CLI | 复用现有代码；能快速验证第二宿主 | 依赖 shell/PATH，工具发现较弱，桌面应用安装体验不同 | 第一项工程验证 |
| Skill + 共享核心 + 薄 MCP | 标准参数、稳定工具发现、多个客户端共用 | 需维护进程环境、超时、权限和安装配置 | 面向粉丝分发的目标形态 |
| 每个 Agent 写专属插件 | 更深的界面/生命周期集成 | 容易复制业务逻辑，随各家版本反复维护 | 仅在通用接口确实不足时增加 |
| 自建一个常驻 Agent 再让各家接它 | 后台处理统一 | 增加模型账单、认证与运维；用户原 Agent 沦为转发层 | 不作为第一版必需项 |

## 长任务与模型使用

默认复用用户当前 Agent 的对话模型，不复制各家 API 密钥，不额外启动第二个 LLM。采集工具返回真实材料，宿主完成整理，核心验证后保存。

如果采用 MCP，拟议工具可以包括 `capture_start`、`job_status`、`artifact_read`、`source_save`、`source_search`、`source_read`。这些是待实现接口。视频转写使用作业 ID 和有限大小、可分页的原文读取，避免一次 MCP 请求阻塞数分钟或一次返回完整长视频文本。

作业只保证已声明的运行生命周期：本机按需进程关闭时可以暂停并下次恢复，不能悄悄承诺后台继续。全天在线另选常驻 worker/消息网关部署。标准 MCP 接口不会让睡眠的笔记本继续运行。

本地保存也不等于全流程离线：若用户宿主使用云模型，交给该宿主整理的原文仍会进入其模型请求；ASR/视觉/embedding 使用远程服务时也要显示对应数据路径。

## 安装体验

对粉丝只要求做有意义的选择：选择常用 Agent、选择知识库目录、完成小红书登录；缺少视频转写时再选本地或远程处理器。多个 Agent 同时安装时让用户明确选择，可多选；不要自动改动全部宿主或默认挑其中一个。

安装器先检测宿主与运行环境，再按需安装核心/Skill/连接器，检查浏览器桥接、模型处理器、目录权限并做一次保存与召回。失败时返回具体能力缺口。卸载只移除安装器管理的配置和程序，保留知识库。

跨 Agent、跨内容平台、跨操作系统是三条独立兼容轴。当前脚本只在 macOS Apple Silicon 上实测；Windows/Linux 不能因为 Node 跨平台就直接标记支持。优先拿真实粉丝机器测安装、浏览器登录和 ASR，之后再扩大支持范围。

## 宿主兼容的验收门槛

宿主接入按能力包实际需要安排。优先复用现有检索实现，只有缺少公共接口时才增加胶水代码。不同宿主读取同一知识库、新会话召回、Skill 发现与工具权限仍是必要的兼容测试，但不应排在第三方能力方案索引之前成为产品主线。

每个组合至少验证：全新来源收藏、重复收藏、部分采集不入正式索引、手改笔记保护、关闭再开会话召回、来源引用、长任务恢复、卸载保留数据。共同测试通过才标记“已适配”，官方声称支持 Skills/MCP 只标记“接口可行”。

本页其余内容保留原始设计上下文，实施状态以当前验收文档为准。
