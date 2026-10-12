# OCR 追加勘误与统一回读

用途：已保存的历史 SourceEnhancement v1 中的 OCR 错字、缺小数点或错误归纳被发现后，追加撤回、待定或校正。原 `source.md`、artifact、增强 Markdown、帧和 OCR 都不覆盖，也不修改人工批注。每个 v1 增强目前只允许一份不可覆盖的勘误，不是通用版本管理系统。默认新处理使用 [v2 视觉协议](source-enhancement-schema.md)，不默认运行或安装 OCR；此勘误入口不套用到 v2。

## 先回读并核对

```sh
node {baseDir}/scripts/brain.mjs read --store '<当前知识库>' --source-id '<来源ID>'
```

`read` 校验来源、增强及帧哈希，再返回 `effective_claims`、由这些事实拼成的 `effective_summary`、标为历史记录的 `original_claims` 和 `reviews`。已经有勘误的旧摘要和旧 Markdown 不再作为有效摘要返回。原 OCR 引文保留在 `evidence`，视觉校正另放 `correction_evidence`，不假装校正文字原本就在 OCR 中。

实际打开相关原帧后才能提出 `corrected`。主模型不具备读图能力但另一具备视觉能力的 Agent 或本人看过原帧时，核对者写后者的实际身份；不把功劳归给没有获得图片的模型。仅审阅 OCR 文本可用 `withdraw` 或 `uncertain`，不能猜一个替代数字。

## 保存一份勘误

输入的 `source_id`、`enhancement_id`、`enhancement_sha256`、`claim_sha256`、`frame_sha256` 都从上述真实 `read` 结果取得，不能从示例复制。`claim_index` 从零开始。下面仅为字段示意，尖括号内容均须替换：

```json
{
  "schema_version": 1,
  "kind": "ocr_review",
  "source_id": "<来源ID>",
  "enhancement_id": "<增强ID>",
  "enhancement_sha256": "<原增强artifact_sha256>",
  "reviewer": {
    "identity": "<实际核图者>",
    "model": "<实际使用的视觉模型；人工或未知用null>",
    "method": "image_tool",
    "visual_input_received": true,
    "reviewed_at": "<实际ISO时间>"
  },
  "items": [{
    "claim_index": 0,
    "claim_sha256": "<目标事实claim_sha256>",
    "disposition": "corrected",
    "reason": "<实际核对发现的问题>",
    "correction": "<已核图后的窄事实>",
    "evidence": [{
      "frame_id": "<原事实对应帧>",
      "frame_sha256": "<原帧哈希>",
      "observed_text": "<实际原图中看到的文字>"
    }]
  }]
}
```

`method` 只接受 `human_visual`、`image_tool`、`ocr_text`。前两项必须真实获得图片；`ocr_text` 必须 `visual_input_received:false`，`observed_text:null`。`withdraw` 和 `uncertain` 均用 `correction:null`，两者都不进入有效事实。`corrected` 需要实际视觉输入和所见文字；结构校验不能证明核对者确实看过图片，也不代替语义审阅。来源本身的观点仍未经外部事实核查。

```sh
node {baseDir}/scripts/brain.mjs save-review --artifact '<勘误JSON>' --store '<当前知识库>'
node {baseDir}/scripts/brain.mjs read --source-id '<来源ID>' --store '<当前知识库>'
node {baseDir}/scripts/brain.mjs search --query '<旧值或新值>' --store '<当前知识库>'
```

勘误原子发布到原增强目录的 `ocr-review/`，含 JSON、Markdown 和回执；相同输入重复返回 `duplicate`，不同输入返回 `REVIEW_CONFLICT`，都不覆盖现有审阅。发布前追加 `ocr-review.required.json` 必读标记，绑定期望勘误哈希。发布中断可能只留下标记，此时该增强暂停引用；保留原输入复跑即可恢复，不删除标记以绕过检查，不手改原增强。

有标记但缺勘误、勘误缺文件、内容哈希错误或绑定目标不符时，`read` / `search` 排除这份增强并返回 `issues`；原来源和其他正常增强继续可读。旧版没有勘误和标记时按原协议兼容。这是损坏与不一致检测，不是防止拥有文件写权限者同时删除所有勘误痕迹的防篡改账本。

## 引用前必须应用勘误

`search` 对已审阅增强只从有效事实产生正常摘录；旧错误值命中时返回校正或撤回/待定提示，并携带勘误。没有被勘误的原有事实仍保留。原 OCR 与旧断言作为历史证据供核对，不能因为它们仍出现在返回 JSON 就再次当作当前事实。

OpenClaw `memory_search` 可能命中旧增强片段或 workspace 记忆，追加 Markdown 后重建索引也不能保证同一次把勘误带回。因此只接受**当前知识库 `Sources/` 内**的候选来源，提取来源 ID 后运行本页 `read`。引用 `effective_claims` 及其证据，检查 `issues`；不能直接引用旧搜索摘要，不把其他 profile、workspace、dreaming 或会话记忆当成本库来源。Hermes 和其他宿主的文件搜索也遵守同一回读步骤。

旧 `verify` 仍检查原来源/增强与附件，不是勘误验收入口；勘误的完整性和实际生效以 `read` 与 `search` 为准。校正保存、宿主索引更新、独立新会话准确引用和微信送达分别验收。
