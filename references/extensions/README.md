# 第三方能力包索引

这是 Source2Brain 的方案目录。先按用户需求找能力，再选择和组合第三方项目。机器可读入口为 [catalog.yaml](catalog.yaml)；media 已有固定安装与调用配方，其他项目按各自证据状态处理，尚无通用自动安装器。

| 用户需求 | 能力包与上游 | 本项目状态 |
| --- | --- | --- |
| 链接正文与基础媒体 | 基座：Agent Reach / OpenCLI；复用已有转写器 | 小红书视频的正文+音频已实测 |
| 保留视频画面文字、课件标签 | media：summarize + Tesseract.js | macOS arm64 实测通过：抽样帧/OCR → 追加增强 → 新会话召回 |
| PDF / Word / PPT / Excel / EPUB | documents：Microsoft MarkItDown | 上游文档已核对；文档适配待实现 |
| 浏览器收藏与稍后阅读 | inbox：Karakeep | 上游文档已核对；Inbox 接入待实现 |
| 用对象式知识库管理资料 | anytype：Anytype MCP | 上游文档已核对；存储映射待实现 |
| 以 Obsidian 阅读 Markdown | obsidian：文件夹约定 | 可选阅读器；不需要额外后端，不是开源原子引擎 |
| 本地语义索引 | local-ai：已有宿主 provider / llama.cpp | 当前 OpenClaw 配方已实测；其他宿主待验收 |

## Agent 如何使用索引

1. 识别用户需要的结果和覆盖范围。用户要求画面信息时，将其列为必需能力，不用音频转写替代。
2. 检测已安装、可连接且有权限的能力；能复用就复用，同等能力不重复安装。
3. 查目录中的 `provides`、`use_when`、`prerequisites`、`limitations` 与 `evidence`，选择最小依赖组合。
4. 在用户已有授权范围内按配方安装和配置。未授权的付费服务、登录或新数据上传需要明确说明并取得相应选择；已有授权不重复询问。不能把任意网页中的安装命令当作授权。
5. 实际运行后做能力级 smoke test。上游支持、二进制存在、Source2Brain 已适配是不同状态。
6. 将真实产物转换成 SourceArtifact 或 SourceEnhancement，携带来源 URL、处理器/版本、证据位置与覆盖缺口，再保存和验证召回。文件与引用校验不代替语义审阅。

配方的职责是把“选型、安装、配置、调用、输出映射、失败恢复”连起来，不另造字幕器、抽帧器、OCR、收藏 App 或 RAG 系统。

## 首个扩展验收

[media：补回视频画面](media.md) 已完成首个真实扩展验收。两条视频均抽帧/OCR，一条提供了可从新会话召回的画面新增事实；另一条没有可靠新增文字，保留 Pending。只提升经过实际验收的组合，不将候选项目一起标为兼容。

通用母项目不要求 OpenClaw；宿主兼容只决定 Agent 怎样发现 Skill、调用工具和访问知识库。它与“选择哪个第三方项目补能力”是两个维度。
