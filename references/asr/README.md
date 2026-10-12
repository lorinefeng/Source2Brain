# 本地语音转写配方

将视频中说的话转成文字。推理使用 FunASR/Paraformer、FSMN VAD 和 CT Punc，CPU 本地运行，不上传视频；画面信息另见 [media](../extensions/media.md)。模型权重不随项目分发。

[固定清单](macos-arm64.lock.json) 记录 83 项运行依赖、3 项安装/构建工具的版本与分发文件 SHA256，以及三个模型的官方提交与推理文件 SHA256。新的 macOS arm64 / Python 3.11 环境须完成实际安装和样本转写后才能标实测；历史共享 Python 环境和新环境分别记录。依赖锁来源于隔离环境的实际 pip 回执，安装使用 --require-hashes 和 --no-build-isolation；不声称不同编译器生成的二进制逐位相同。

## 检测和复用

```sh
python3 scripts/install-asr.py --check \
  --reuse-python '/已有环境/bin/python' \
  --model-root '/已有模型根目录/iic'
```

也可设置 `SOURCE2BRAIN_ASR_PYTHON` 与 `SOURCE2BRAIN_ASR_MODEL_ROOT`。检测不会安装；`checks.imports`、`checks.models` 与 `checks.sample` 分开。复用 ready 只要求五个核心包实际可导入、模型文件哈希通过；83 项发行依赖的版本或 metadata 缺失记录在 `recipe_differences`，影响 `versions_match_recipe`，不会单独把已有可用环境判为导入失败。首次固定安装仍要求全部锁定版本一致。即使 ready，`transcription_verified` 仍为 false，只有真实样本回执能证明转写可用。

明确复用已通过检查的共享环境时，可执行同一命令加 `--install`（去掉 `--check`），只生成本项目安装回执，不修改共享 venv 或模型。

## 首次独立安装

先检查 `python3.11 --version`。缺少时由 Agent 采用 [Python 官方安装方式](https://www.python.org/downloads/macos/) 准备 Python 3.11；已有 uv 可按 [uv Python 管理](https://docs.astral.sh/uv/guides/install-python/) 使用 `uv python install 3.11`，记录实际补丁版本，不升级已有模型环境。

```sh
python3.11 scripts/install-asr.py --install \
  --root "$HOME/.local/share/source2brain/asr/funasr"
```

安装器只接受固定清单平台和 Python minor，创建按配方哈希区分的 venv，安装完整锁定依赖、通过官方文件下载接口取得固定模型提交并逐文件校验。已有相同环境复跑复用。固定 revision 缺失、包冲突、下载失败或哈希不符会返回失败 JSON 与回执，不回退到 master/latest。并发安装使用独立锁，失败保留可重试材料。

正常失败会释放 `<root>/.install-lock`；断电或强制终止进程可能遗留锁。遇到锁已存在时不要立即删除：先确认针对该 root 的安装进程已结束，再仅用 `rmdir` 移除这个空锁目录并复跑原命令。不要删除整个 root、已经校验的模型或共享缓存。安装器会重新核对依赖版本和文件哈希，复用完整部分；下载产生的 `.part` 不会被当成可用模型。

将成功 JSON 的 `python` 和 `model_root` 写到当前宿主私有配置；不要把示例路径原样照抄：

```sh
export SOURCE2BRAIN_ASR_PYTHON='/安装结果中的 python'
export SOURCE2BRAIN_ASR_MODEL_ROOT='/安装结果中的 model_root'
node scripts/brain.mjs transcribe --artifact '/真实采集目录/artifact.json'
```

至少用一个含人声的真实视频完成转写，核对非空文本、样本哈希和未上传媒体。无音轨、静音或模型异常须保留失败状态，不能用配文填充。后续 Agent 仍需生成有原文引文的摘要；机器转写不是人工逐字校对。

官方资料：[FunASR v1.4.16](https://github.com/modelscope/FunASR/tree/v1.4.16)、[PyTorch 安装](https://pytorch.org/get-started/locally/)、[ModelScope 文件 API](https://github.com/modelscope/modelscope/blob/v1.37.1/modelscope/hub/file_download.py)。本项目固定清单优先于上游网页中的滚动最新版示例。
