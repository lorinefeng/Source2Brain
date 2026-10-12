# SourceArtifact v1

JSON 是适配器与 Markdown writer 之间的唯一协议。运行时校验器为 `lib/artifact.mjs`，`save` 始终先校验。

```json
{
  "schema_version": 1,
  "source": {
    "url": "https://www.xiaohongshu.com/explore/000000000000000000000001",
    "original_url": "https://www.xiaohongshu.com/explore/000000000000000000000001",
    "platform": "xiaohongshu",
    "title": "合成示例，不是真实来源",
    "author": null,
    "published_at": null,
    "captured_at": "2026-09-29T00:00:00.000Z"
  },
  "content": {
    "type": "post",
    "text": "这个合成例子建议先保留来源。",
    "transcript": "",
    "visual_notes": ""
  },
  "extraction": {
    "status": "complete",
    "text": "complete",
    "transcript": "not_applicable",
    "visuals": "not_applicable",
    "limitations": []
  },
  "knowledge": {
    "summary": "示例强调保存来源。",
    "claims": [{ "text": "先保留来源", "evidence": [{ "field": "text", "quote": "建议先保留来源" }] }],
    "insights": [],
    "actions": ["尝试为笔记添加原链接"],
    "related_topics": ["来源追溯"]
  },
  "provenance": {
    "adapter": "synthetic-test",
    "model": "synthetic-test",
    "steps": ["合成测试，不代表平台采集"]
  }
}
```

`source.url` 保存解析后的 URL，writer 归一为无跟踪参数的原始出处；`original_url` 保留用户实际发送的链接。`published_at` 不应使用采集日期代替。

候选版增加 `platform: "douyin"` 的单条视频来源：标准链接为 `https://www.douyin.com/video/<数字ID>`，官方 `v.douyin.com` 分享短链先在浏览器解析。小红书继续使用 `xhs-<24位ID>`，抖音使用独立 `dy-<数字ID>` 目录；原分享链接与最终来源必须同平台，若原链接已有 ID 则必须一致。已有小红书 ID、内容哈希、目录和增强引用不变。抖音图集、直播、用户主页不在此配方范围。

`content.type` 为 `post` 或 `video`。各覆盖字段为 `complete`、`missing`、`not_applicable`。只有确认没有图片的纯文字帖，才可将 visuals 设为 not_applicable。视频无画面可以按第一阶段约定完成，但须在 limitations 中明确“只覆盖音频，不包含画面”。转写是 ASR 结果，不等同于作者校对稿。

`claims[].evidence` 的 `field` 只能是 text、transcript、visual_notes，quote 必须逐字匹配对应内容。算法校验只保证有匹配引文，不能证明总结语义正确，仍需 Agent 审阅。`insights` 是模型推断，`actions` 是尚未执行的建议。

作者缺失、发布时间缺失不会阻止保存，但必须保持未知。正文、图片或转写缺失则标记 partial。`.source2brain` 和 `Pending` 不进入召回索引。
