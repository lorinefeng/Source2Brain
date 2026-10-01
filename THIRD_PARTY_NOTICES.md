# 上游项目与致谢

Source2Brain 的价值来自成熟能力的组合，以及把安装调用经验、知识协议和验收方法整理成可复用配方。第三方项目保留各自许可证；本仓库 MIT 许可仅覆盖本项目原创内容。

| 项目 | 本项目中的职责 | 许可／分发方式 |
| --- | --- | --- |
| [Agent Reach](https://github.com/Panniantong/Agent-Reach) | 平台能力检测与互联网采集路由 | MIT；独立安装 |
| [OpenCLI](https://github.com/jackwener/opencli) | 小红书浏览器采集 | Apache-2.0；独立安装 |
| [summarize](https://github.com/steipete/summarize) | media 关键帧和时间戳 | MIT；按 media 锁文件安装 |
| [Tesseract.js](https://github.com/naptha/tesseract.js) | 中英文 OCR | Apache-2.0；按 media 锁文件安装 |
| [OpenClaw](https://github.com/openclaw/openclaw) | 参考宿主与语义检索 | MIT；可选宿主 |
| [openclaw-weixin](https://github.com/Tencent/openclaw-weixin) | 参考部署微信通道 | MIT；可选入口 |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | 第二宿主，复用已有模型与工具执行 | MIT；可选宿主 |
| [FunASR](https://github.com/modelscope/FunASR) | 本地转写参考实现 | MIT；模型权重按各自条款另取 |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) | OpenClaw 部署中的 embedding 运行时 | MIT；独立运行时 |

media 的传递依赖、语言数据和完整性字段保存在 `references/extensions/media-runtime/package-lock.json`。安装时保留 npm 包自带许可证；本项目 Release 不打包 node_modules、FFmpeg 二进制或模型权重。所使用的 EmbeddingGemma 权重遵循上游 Gemma 条款，不适用本项目 MIT 许可。

MarkItDown、Karakeep、Anytype 等目前是候选索引，不能以本表暗示已完成适配。Remotion 是后续视频制作工具，不属于用户运行知识库的依赖。
