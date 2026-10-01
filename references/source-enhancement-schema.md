# SourceEnhancement v1：已有来源的画面补充

这是独立于 SourceArtifact v1 的追加协议。原来源、正文和人工批注不改写；新增结果通过 source.id 与 base_content_sha256 绑定已保存版本。当前只支持已进入 Sources 的小红书视频。

## 字段与状态

- `schema_version: 1`、`kind: source_enhancement`、`pack: media`。
- `source`：原来源 ID、规范 URL、标题、原内容 SHA-256、输入视频 SHA-256。
- `processor`：适配器、summarize、OCR、语言数据版本以及运行依赖锁文件 SHA-256。
- `parameters`：默认最多 24 帧、阈值 0.2、最小间隔 2 秒、chi_sim+eng、PSM 3；一次加密抽样为最多 48 帧、阈值 0.1。
- `coverage`：scope 固定为 sampled_frames_ocr；分别记录抽帧、OCR、Agent 整理状态和限制。这里的 complete 只表示指定抽样流程完成，不是全片视觉理解。
- `frames[]`：稳定 ID、相对 PNG 路径、文件 SHA-256、timestamp_seconds、OCR 状态/原文/0–1 置信度。没有文字可以返回空字符串；识别故障必须明确标为 failed。
- `knowledge`：新增信息摘要与 claims。每条 claim 必须包含 `evidence: [{frame_id, quote}]`，quote 必须逐字出现在指定帧的 OCR 中。数值关系和解释由 Agent 核对，算法不证明语义正确。
- `provenance`：实际整理模型、生成时间、做过的步骤。提取器使用 model: pending，不能自动标记整理完成。

全部抽帧/OCR 完成、Agent 已整理且至少一条事实有有效引文，才可将 coverage.status 和 coverage.review 设为 complete。必须一直保留抽样与 OCR 限制，不得为进入 Sources 编造事实。

发布前需要逐条语义审阅：有效引文不能为不在引文中的标签、数字、位置关系背书。看不清或 OCR 读错时删除相应断言，不能把推断写成“作者画面事实”。已发布的重复处理不会改写摘要；发现本次尚未验收、尚未索引的机器草稿错误时，由维护者先确认无人工修改、备份隔离该草稿，再重新发布候选，不绕过 duplicate 保护覆盖用户笔记。

## 保存与回读

```sh
node scripts/brain.mjs validate --artifact /新目录/enhancement.json
node scripts/brain.mjs save-enhancement --artifact /新目录/enhancement.json --store ~/SecondBrain
node scripts/brain.mjs verify --store ~/SecondBrain
```

完整增强写入 Sources/来源ID/enhancements/增强ID，包含 enhancement.json、enhancement.md、receipt.json 和 frames。部分结果写入 Pending 的同结构目录，不参与召回。附件复制并校验后整个目录原子发布，失败不发布一半结果。

同一来源版本、视频、处理器和参数决定稳定增强 ID；字段顺序、模型措辞和运行时间不制造重复版本。再次保存返回 duplicate，不覆盖增强 Markdown 的人工修改。新的采样参数产生新版本。未完成候选仍保留在工作目录或 Pending，完成后可发布到 Sources。

verify 同时检查增强结果、帧摘要和原来源关联；Markdown 被人工编辑会标注 edited，不自动恢复或覆盖。变更原来源正文属于另一套更新流程。
