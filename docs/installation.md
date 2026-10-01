# macOS 安装与排障

本文是 OpenClaw 常驻参考部署。已有 Hermes 请从 [Hermes 接入](../references/hosts/hermes.md) 开始；其他宿主见 [官方资料索引](../references/hosts/README.md)。完整粉丝首次安装与干净重装演示按首发安排在开源之后，本轮不提前卸载现有环境。

## 已验证布局

| 位置 | 用途 |
| --- | --- |
| 项目目录 | 源码、测试、Skill 与安装记录 |
| `~/.local/share/source2brain/runtime/` | 独立 Node、OpenClaw |
| `~/.openclaw-source2brain/` | profile 配置、认证、本地索引 |
| `~/.local/share/source2brain/workspace/` | 运行 Agent 的指令与 Skill |
| `~/.local/share/source2brain/captures/` | 私有原始采集、媒体、转写 |
| `~/SecondBrain/Sources/` | 成功来源，进入检索 |
| `~/SecondBrain/Pending/` | 缺失材料，不进入检索 |

首阶段实测 Apple Silicon / macOS。Intel 路径在引导脚本中保留，但尚未实机验证。机器需要保持登录桌面，OpenCLI 依赖浏览器桥接；仅启动 SSH 不等于浏览器已就绪。

## 1. 独立运行时

```sh
bash scripts/bootstrap-macos.sh
bash scripts/openclaw.sh --version
```

Node 26.8.2 从官方发行站下载并校验 SHA-256，OpenClaw 固定为 2026.9.6，profile 固定为 source2brain。脚本不使用 `sudo`，不替换系统 Node。

引导脚本首次安装 Skill；重复执行会先备份现有 Skill，再安装本仓库版本。需要单独更新时，先备份 workspace 的 Skill，再重新打包安装：

```sh
# 需使用已安装的 Node，或把其 bin 目录加入 PATH。
skill_dir=$(node scripts/package-skill.mjs)
bash scripts/openclaw.sh skills install "$skill_dir" --as source2brain --force
```

打包器只携带运行所需文件，不复制 `.git/`、`.local/`、密钥、二维码或验收样本。

## 2. 对话模型

已有 Hermes 配置时，仅在运行主机导入明确选定的 provider，使用装有 PyYAML 的 Python：

```sh
python scripts/configure-openclaw.py \
  --from-hermes ~/.hermes/config.yaml \
  --provider PROVIDER_NAME \
  --model MODEL_ID
```

没有 Hermes 时，通过本机环境变量提供密钥，使用 `--base-url`、`--provider`、`--model` 和 `--key-env`。不要把真实密钥写入命令或聊天。脚本将其放入权限 0600 的 profile `.env`，调用官方 `config patch` 写入配置，并事先备份现有文件。

当前配置器面向 OpenAI Chat Completions 兼容服务，保守使用 128K 上下文与 8192 输出上限；其他模型的能力需单独核验。只有真实请求返回后才能称为模型连通。

## 3. Agent Reach 与浏览器

安装遵循 [Agent Reach 上游指南](https://github.com/Panniantong/Agent-Reach)。已有安装先复用，不要重复安装所有平台工具。本项目当前适配 OpenCLI。

```sh
agent-reach doctor --json
opencli --version
```

在运行主机打开 Chrome，安装或连接 OpenCLI 浏览器桥接，并登录小红书。新版 doctor 可能只报告 `warn` / 桥接已连接，这是要求实际读取验证，不代表未安装或登录失败。

先用一个真实短链验证：

```sh
node scripts/brain.mjs capture \
  --message '用户完整的小红书分享文本' \
  --out "$HOME/.local/share/source2brain/captures/first-check"
```

输出目录必须是新的。捕获成功仍为 `partial`，直到媒体被处理、摘要经证据约束生成后才能入库。

## 4. 复用本地中文转写

本次使用已有的 FunASR Python 环境及 ModelScope 缓存，没有另装 Whisper。实测版本：FunASR 1.4.16、PyTorch 2.8.0、PyAV 15.1.0。首次搭建者需自行按 FunASR 上游安装兼容环境和模型，首阶段引导脚本尚不自动安装这部分。

默认从 `~/.cache/modelscope/hub/models/iic/` 读取以下三个目录：

- `speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch`
- `speech_fsmn_vad_zh-cn-16k-common-pytorch`
- `punc_ct-transformer_cn-en-common-vocab471067-large`

在运行端 profile 的 `.env` 配置 `SOURCE2BRAIN_ASR_PYTHON=/绝对路径/venv/bin/python`。脚本使用 PyAV 从视频提取 16kHz 单声道音频，CPU 转写；不会自动下载或上传模型/媒体。

```sh
node scripts/brain.mjs transcribe --artifact /采集目录/artifact.json
```

它输出 `artifact-transcribed.json`，仍需 LLM 生成摘要与证据，并将合格来源标记 complete。也可用 `--from /已有转写.json` 复用结果。

Agent Reach 的默认转写服务是 Groq/OpenAI；对话中转站的密钥不能直接拿去调用这些供应商。其他 ASR 后端是后续扩展接口。

## 5. 本地语义检索

本次使用 OpenClaw 官方 llama.cpp provider、EmbeddingGemma 300M Q8，约 0.3GB。

```sh
bash scripts/openclaw.sh plugins install @openclaw/llama-cpp-provider@2026.9.6
bash scripts/openclaw.sh config set memory.search.provider local
bash scripts/openclaw.sh models auth login --provider llama-cpp --method local
```

在交互设置里仅选择 embedding：如果出现大语言模型下载选项，跳过聊天模型，然后选择仅下载 embedding。它不会替换已配置的聊天模型。

```sh
bash scripts/openclaw.sh memory status --deep
bash scripts/openclaw.sh memory index --force
bash scripts/openclaw.sh memory search '笔记主题'
```

只有 `embeddingProbe.ok=true` 与实际命中才能证明这部分可用。`provider=none` 是关键词模式，不是语义检索。知识库的额外索引路径只添加 `~/SecondBrain/Sources`，不添加 Pending 或调试资料；OpenClaw 自身的 workspace memory 仍按其默认规则参与索引。

## 6. 微信与常驻服务

```sh
bash scripts/openclaw.sh plugins install @tencent-weixin/openclaw-weixin@2.4.9
bash scripts/openclaw.sh channels login --channel openclaw-weixin
```

本人在微信扫码确认。二维码会过期，应使用当前登录命令刷新的二维码；仅展示旧图片不会恢复有效期。不要直接复用另一个正在轮询的 Agent 的微信 token。

将 `templates/workspace/` 中的中文指令安装到独立 workspace；替换已有文件前先备份。它使直接发送链接被视为收藏请求，并声明来源不可信、原文证据和私有资料边界。

```sh
bash scripts/openclaw.sh config validate
bash scripts/openclaw.sh gateway install --port 19291
bash scripts/openclaw.sh gateway start
bash scripts/openclaw.sh health --json
```

此处使用用户级 LaunchAgent，保持 Mac mini 登录桌面和正常联网。OpenCLI 需要可用的浏览器会话，因此不能把“服务已运行”当作“整条采集链随时可用”。

验收时先发一个链接；收到保存回复后发 `/new`，再用自己的话询问内容，不粘贴原链接或答案。保存、召回和微信回复应分别核对。

## 实测问题与处理

| 现象 | 已验证处理 |
| --- | --- |
| SSH 找不到 node / agent-reach，桌面能用 | 非交互 PATH 不同；使用项目 wrapper 加入独立运行时、`~/.local/bin` 和 `/usr/local/bin` |
| 短链 curl/HEAD 404 或超时，浏览器可打开 | 在独立 OpenCLI 浏览器 session 中解析跳转，不直接判定笔记删除 |
| OpenCLI `Navigation rejected` | 笔记和下载命令使用 `--site-session ephemeral`，避免残留会话导航冲突 |
| 上游 note 的 title 返回“手机号登录” | 使用实际笔记页 document title；拒绝把登录界面名称当笔记标题 |
| config patch 拒绝 auto-managed meta | 只传本项目负责的最小 patch，不把读取到的整个配置再写回 |
| Skill 已存在，安装失败 | 明确使用更新流程和 `--force`，先备份；不要悄悄覆盖其他 Skill |
| 微信登录完成但提示 gateway 不可达 | 认证与进程是两步，启动独立 profile Gateway 后查看 health 与实际消息回执 |

本页是安装经验记录，不宣称首阶段已经实现无人参与的一键安装。平台认证、首次 ASR 安装与跨平台支持仍需要后续完善。
