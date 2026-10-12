# PaddleOCR：可选识字与文档解析候选

状态：2026-10-07 核对上游官方资料；本项目未安装、未实测，也不随默认 media 安装。本次部署优先复用用户指定的多模态模型。不能把其他 OCR 的效果或上游榜单替代本项目样本验收。

## 何时考虑

需要大批量文字提取、离线运行或成本控制，并且现有 Agent 的视觉能力不足时，可评估 PaddleOCR。PP-OCR 系列主要做文字检测/识别；PaddleOCR-VL 是面向文档结构、文字、表格等的视觉语言模型，应按实际任务选择，不把它等同于通用视频理解。

## 上游入口与前置条件

- [官方仓库](https://github.com/PaddlePaddle/PaddleOCR)，Apache-2.0。核对时最新 Release 为 [v3.7.0](https://github.com/PaddlePaddle/PaddleOCR/releases/tag/v3.7.0)，不是本项目锁定安装版本。
- [PaddleOCR-VL 使用说明](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/PaddleOCR-VL.html)：当前文档含 VL-1.6；版本与模型需成套核对。
- [Apple Silicon 官方路线](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/PaddleOCR-VL-Apple-Silicon.html)：独立虚拟环境、PaddlePaddle，另有 MLX-VLM 推理服务路线。官方说明已验证 M4，其他机型须另测；模型推理服务不等同完整文档解析接口。

安装前先检测用户已有环境、机器架构、模型缓存与磁盘余量；确定具体方案后再固定包版本、模型 revision、哈希、安装/卸载边界，不给滚动 `pip install -U` 命令充当可复现配方。账号或付费云 API 不是默认前置条件，也不复用无关供应商密钥。

## 待适配与验收

识别输出需映射到来源原图、SHA256、页序或视频帧秒数，保留原结果及识别错误；知识摘要与作者原文分开。未来适配必须测试中文密集截图、代码/UI、小数点、百分号、空白图与小字，重点检查本项目已经发现的 18G、4.2 星及任务名称案例。对比原生多模态的正确率、漏字、耗时和资源，再决定是否提供可选配方。

当前没有 Source2Brain 的固定安装脚本和已验收结果映射。Agent 只能将其作为候选，不可称“本项目已支持”或自动安装。
