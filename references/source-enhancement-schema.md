# SourceEnhancement：默认视觉 v2，兼容历史 OCR v1

这是独立于 SourceArtifact v1 的追加协议。原来源、正文和人工批注不改写；增强通过 source.id、base_content_sha256 与视频 SHA256 绑定已保存版本。支持已进入 Sources 的小红书或抖音视频，平台实际验证范围分别记录。

## 默认 v2：抽样帧与实际视觉输入

- `schema_version: 2`、`kind: source_enhancement`、`pack: media`。
- `source`：原来源 ID、规范 URL、标题、原内容 SHA256、输入视频 SHA256。
- `processor`：`adapter`、`summarize` 实际版本、`runtime_lock_sha256`；`vision` 为 `host-native` 或 `explicit-visual-tool`，分别表示宿主原生视觉与用户明确指定的视觉工具，不表示安装新的模型。
- `parameters`：最多 24 帧、场景阈值 0.2、最小间隔 2 秒；仅一次补抽样为最多 48 帧、阈值 0.1。不带 OCR 语言数据要求。
- `coverage`：`scope: sampled_frames_vision`；`status: partial|complete`、`frames: missing|complete`、`vision: pending|partial|complete`、`review: pending|complete` 与非空 `limitations`。`complete` 只表示当前抽样材料完成识读与整理，不是全片或连续动作理解。
- `frames[]`：稳定 `id`、相对 `frames/<id>.png` 路径、文件 SHA256、秒数 `timestamp_seconds` 与 `vision`。
- `knowledge`：摘要和 claims；每条 claim 的 `evidence: [{frame_id, quote}]` 必须逐字匹配该帧 `vision.text`。`description` 可辅助看懂所见对象，不作为本轮文字事实的逐字证据。
- `provenance`：本次整理模型、生成时间和实际步骤；看图模型另记在每帧 reviewer。主聊天模型可以只有文本能力，前提是所选视觉工具确实接收了图片。

抽帧后的每帧先是：

```json
{
  "vision": {
    "status": "pending",
    "text": "",
    "description": "",
    "reviewer": null
  }
}
```

只有真实看图后才补为：

```json
{
  "vision": {
    "status": "complete",
    "text": "逐字识读的画面文字；没有可读文字时为空",
    "description": "必要且有图像依据的可见描述",
    "reviewer": {
      "identity": "实际视觉执行者",
      "model": "实际看图的模型标识；未知或人工时为null",
      "tool": "实际返回图像输入或视觉识读结果的工具名",
      "visual_input_received": true,
      "reviewed_at": "2026-10-07T00:00:00.000Z"
    }
  }
}
```

上面是字段示意，不可照抄时间、模型或完成状态。`visual_input_received:true` 记录图片确实送达执行识读的模型/本人；仅文字读取成功、拿到本地路径、读出字节或从旧 OCR 转抄均不算看图。工具若失败，用 `status: failed`、空 text/description、`reviewer:null` 和实际 `error_code`；未尝试则保持 pending。

全部抽样帧都已实际识读、Agent 已审阅并且至少有一条真实文字事实，才把 coverage 的 status、vision、review 标为 complete。看过但没有文字的帧可以 `vision.status: complete`、text 为空；若整份材料没有可引用文字，不能凑事实使整体 complete。没有原生多模态能力且没有用户指定的可用视觉工具时保留 Pending，不自动装新模型或猜供应商。

结构校验验证状态、声明、逐字引文和文件完整性；它不能证明填写者确实看图，也不能证明模型识读与归纳没有错误。发布前仍须检查数字、小数点、单位、图标以及每条断言是否超出所见文本。只记录实际用到的工具与模型，不把另一个 Agent 的核对归到主模型名下。

视觉识读提示应把逐字文字与可见描述分开。遇到模糊字标不确定，不按上下文补字；不猜画面所属应用、游戏、作品、网站或作者，没有明确可见文字支持的归因不进入事实。即使识读模型输出这类猜测，也不能复制到 vision.text 来制造逐字证据。

## 历史 v1：抽样帧与 OCR

旧结果及身份保持兼容，不重新转成 v2、不改旧笔记：

- `schema_version: 1`、`coverage.scope: sampled_frames_ocr`。
- processor 保留 summarize、OCR、语言数据版本与运行锁哈希。
- parameters 保留原抽帧参数、`chi_sim+eng`、PSM 3 与已有子语言设置。
- frame.ocr 保留原状态、原文、0–1 置信度及失败码；quote 匹配原 OCR。
- 全部抽帧/OCR/审阅完成且有真实事实后才可按旧规则 complete。置信度不代表事实准确。

v1 仅是兼容与显式历史复验路径，不是默认新安装/新处理方案。已经保存的 OCR 错误使用[追加勘误与统一回读](ocr-review.md)，不修改 OCR 或原增强来伪造正确引文。

## 原子保存、去重与回读

```sh
node {baseDir}/scripts/brain.mjs validate --artifact '/新目录/enhancement.json'
node {baseDir}/scripts/brain.mjs save-enhancement --artifact '/新目录/enhancement.json' --store '<当前知识库>'
node {baseDir}/scripts/brain.mjs read --source-id '<来源ID>' --store '<当前知识库>'
node {baseDir}/scripts/brain.mjs verify --store '<当前知识库>'
```

完整增强进入 `Sources/来源ID/enhancements/增强ID`，包含 JSON、Markdown、receipt 与帧；部分结果进入 Pending 同结构目录，不参与召回。复制并逐文件校验后原子发布，失败不留下半份完整增强。无效时间戳、路径越界、符号链接、缺文件、哈希不符或虚构引文都会拒绝。

v1 的稳定 ID 算法不变；v2 在原来源、视频、处理器与参数身份中加入 schema_version，避免跨版本混淆。模型措辞与运行时间不产生新增强。相同处理重复返回 duplicate，不覆盖原 Markdown 或人工批注；换视觉工具路线或采样参数是不同处理身份，不应用来绕过已有版本的纠错约束。

`read` 是引用前的统一入口，返回有效事实、原证据、真实视觉 reviewer、时间戳和已有 v1 勘误。`verify` 检查原增强及附件，并识别 Markdown 人工编辑；它不代替勘误层或实际视觉语义核查。保存、宿主索引、新会话召回和消息送达仍分层验收。
