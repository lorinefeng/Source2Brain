# media：为已有视频补充画面文字证据

本配方用于用户要求保留画面文字、数字、课件时，增强已保存的视频来源。它组合第三方工具，复用现有视频、ASR 和宿主模型；不另造抽帧器或 OCR。范围是抽样帧与 OCR，不包含图表关系、动作或全片视觉理解。实测状态以 catalog.yaml 的 evidence 为准。

## 1. 识别需求与检测

普通音频收藏不需要此包。先确认用户需要画面文字，原来源已保存且 provenance.media_files 中的本地 MP4 仍存在。视频已丢失时回到采集配方，不能凭旧转写补画面。

```sh
node {baseDir}/scripts/brain.mjs doctor --pack media
```

检测只读，不安装、不下载模型。默认运行目录为 ~/.local/share/source2brain/runtime/media，可通过 SOURCE2BRAIN_MEDIA_RUNTIME 指定已有兼容目录；版本和锁文件须匹配受支持配方。已有就绪环境直接复用。

## 2. 按需安装固定组合

在本次需求及已有授权范围内执行：

```sh
node {baseDir}/scripts/install-media.mjs
```

固定组合为 summarize 0.24.0、Tesseract.js 7.0.0、中英文语言包各 1.0.0。依赖锁文件包含完整性摘要，安装回执记录环境；失败保留旧运行目录，复跑就绪环境不重装。Node 需要 24+；基础安装不会安装本包。不为本地 MP4 安装 yt-dlp、Homebrew、云端转写器或另一套 Agent。

summarize 使用已有原生 FFmpeg 或自带 FFmpeg WebAssembly。OCR 走独立 Tesseract.js：summarize 0.24.0 的原生 OCR 清理会删除纯中文行，因此本配方不使用 --slides-ocr。语言文件由固定 npm 包提供，识别时只读本地数据，不上传媒体。

初始化显式设置 `tessedit_load_sublangs: ''`，仅使用指定的中英文语言；本机对照实验中，这消除了默认初始化出现的乱码子语言加载告警。该参数参与处理身份，不把不同参数的运行误判为同一次处理。

## 3. 提取并整理

```sh
node {baseDir}/scripts/brain.mjs enhance --pack media --artifact /知识库/Sources/来源ID/artifact.json --out /新的处理目录
```

返回 enhancement.json 与帧文件。默认最多 24 帧、阈值 0.2、最小间隔 2 秒。若没有足够可引用文字，最多在另一个新目录加 --retry 一次，采用最多 48 帧、阈值 0.1。两次仍不足就明确缺口，不无限抽帧或自动改用云服务。

Agent 读取原转写、增强 JSON 和相关帧，整理画面新增信息。保留 OCR 原文，每条事实使用 frame_id + quote 精确引用，对模糊数字不能猜测。修改仅限 knowledge、实际模型及处理步骤、完成状态；帧路径、摘要、时间戳和 OCR 原文不随总结改写。详细约束见 [SourceEnhancement v1](../source-enhancement-schema.md)。

发布前逐条检查“事实是否真的由引用支持”。OCR 中存在引文不代表摘要里的每个词都正确：不能把错字猜成新标签，不能从单个词扩写出“可勾选”、界面位置或未识别到的选项。可去除中文词间空格形成可读表述，但不能凭常识补字；没有视觉工具时如实记录，并只保留 OCR 足以支持的窄事实。校验器只验证引用和文件完整性，不代替语义审阅。

只有抽帧、OCR 和整理均完成，才设 coverage.status: complete、coverage.review: complete；删除“尚待 Agent 阅读与整理”这条已解决限制，保留抽样、OCR 等固有限制。部分失败继续 partial。当前接口增强已有 Sources，不将未完成的新来源偷换成仅音频完成。

## 4. 保存与实际回读

```sh
node {baseDir}/scripts/brain.mjs validate --artifact /新的处理目录/enhancement.json
node {baseDir}/scripts/brain.mjs save-enhancement --artifact /新的处理目录/enhancement.json --store /知识库
node {baseDir}/scripts/brain.mjs verify --store /知识库
```

完整增强进入原来源下的独立目录，旧笔记和人工批注不变。重复调用不覆盖增强笔记。保存不等于索引完成：调用宿主已有索引能力，再用新会话检索画面特有事实，返回原链接、帧路径和时间戳。相对帧路径按持久补充目录解析，不能把捕获工作目录误作附件位置。

## 5. 首次组合验收

选择一个图中存在但口播未提及的文字事实或数字，查看实际帧核对，并证明它能在保存后由新会话召回。提取若干帧、OCR 返回很多字、安装成功均不能替代此验收。若素材只有口播字幕，应换样本验证新增信息，不降低标准。

上游资料：[summarize slides](https://github.com/steipete/summarize/blob/v0.24.0/docs/commands/slides.md)、[中文过滤限制](https://github.com/steipete/summarize/blob/v0.24.0/src/slides/ocr.ts)、[Tesseract.js API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md)。
