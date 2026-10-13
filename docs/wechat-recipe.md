# 微信常驻视频整理配方

用途：用户在手机微信把抖音、小红书链接发给 ClawBot，运行电脑上的 OpenClaw 接收并整理，再在原对话回复。本配方是可选参考部署，不要求 Hermes、WorkBuddy 等宿主安装 OpenClaw。各层验收状态见 [验证矩阵](v0.2-validation.md)。

## 先复用，再安装

先检查目标机器是否已有 Source2Brain profile、Gateway 和微信绑定。已有可用服务只更新备份后的 Skill；不要复制另一个正在轮询的 Agent token，不创建第二个服务竞争同一绑定。本项目当前 Mini 服务不能因拍摄而切换绑定。

```sh
export SOURCE2BRAIN_PROFILE=source2brain
bash scripts/bootstrap-macos.sh --check
```

默认只检测，不下载。明确选择常驻路线且有缺失时：

```sh
bash scripts/bootstrap-macos.sh --install
bash scripts/openclaw.sh --version
```

检测到可用 Node 24+ 时复用；否则安装独立 Node 26.8.2 并校验官方 SHA256。OpenClaw 自动复用本配方已验证版本 2026.9.6，否则装入独立 runtime，不升级另一套安装。可用 `SOURCE2BRAIN_NODE_BIN`、`SOURCE2BRAIN_OPENCLAW_BIN` 指定已确认的可执行文件。记录实际版本，指定其他版本不等于本项目已验收。

`SOURCE2BRAIN_PROFILE`、`SOURCE2BRAIN_WORKSPACE` 在 bootstrap、wrapper 和配置器之间一致。安装验收使用独立 profile、workspace、store 与端口；该隔离 profile 不登录现有微信账号。

## 模型和知识目录

推荐原生支持多模态的 Agent 作为常驻资源链接整理模型，同时复用用户明确选定的模型。只有文本能力时，可为本项目 profile 配置用户明确选定的视觉工具；保留主聊天模型，实际用图片验证视觉调用成功。接口地址及密钥放私有运行配置，不写入 AGENTS.md、仓库或发行包。没有可用视觉能力时报告缺口，不静默安装 OCR。已有 Hermes 可仅导入指定 provider，需该 Python 具备 PyYAML；不读取或打印整个配置：

```sh
python scripts/configure-openclaw.py \
  --from-hermes "$HOME/.hermes/config.yaml" \
  --provider PROVIDER_NAME --model MODEL_ID
```

其他情况在运行端私有环境配置密钥，用 `--base-url`、`--provider`、`--model`、`--key-env`。不把密钥写入参数、聊天或 Git。配置器先备份 `.env` 和 `openclaw.json`，只通过官方 config patch 应用本项目字段，失败恢复两份原文件。它面向 OpenAI Chat Completions 兼容服务，不自动宣称任何 provider 已连通。

默认知识目录 `~/SecondBrain`，只向检索添加 Sources。已有 embedding 先复用；需要首次本地语义索引时按 [OpenClaw 说明](../references/openclaw.md) 配置，不能以关键词检索冒充语义检索。

## 处理中回执需要消息工具

OpenClaw 2026.9.6 的 `coding` 工具配置不包含 `message`。本配方需要在原微信对话先发送接收提示，因此只在用户选择微信入口后，为本项目 profile 追加此工具；不要切成 `full`，也不更改其他 profile。依据见 [官方工具策略](https://docs.openclaw.ai/gateway/config-tools/tool-policy)。

先在私有运行端备份目标 `openclaw.json`，只检查当前 `tools.profile`、`allow`、`alsoAllow`、`deny` 及目标 Agent/provider 的同名限制，不输出完整配置。按实际形状合并：

- 同层没有 `allow` 时，在原有 `alsoAllow` 数组中去重追加 `message`，保留其他条目。新建且没有其他条目时，补丁如下。
- 同层已经有 `allow` 时，在原数组中去重追加 `message`，保留其他条目；不能同时添加 `alsoAllow`。官方校验拒绝同层同时配置两者。
- 任何既有 `deny` 或其他层策略禁止消息时，保持限制并报告早期回执能力缺失；不删除限制、扩大通配符或改用 CLI 绕过。配置成功也需检查该目标会话实际可见的工具。

下面仅适用于已确认 `allow` 未设置、`alsoAllow` 为空且没有冲突限制的本项目 profile；其他情况由 Agent 生成上述合并补丁，不能照抄覆盖数组。设置 `SOURCE2BRAIN_PROFILE` 后使用本包 wrapper：

```sh
bash scripts/openclaw.sh config patch --stdin <<'JSON'
{"tools":{"alsoAllow":["message"]}}
JSON
bash scripts/openclaw.sh config validate
```

已有服务等当前来源处理结束后再应用；按宿主要求使配置生效，不重装 Gateway、不重新绑定微信。新会话确认工具可见只能证明配置层；实际早期回执和最终送达仍需本人发起真实链接验证。

## 采集、转写与画面

按 [安装指南](installation.md) 准备运行电脑的浏览器桥接、专用平台账号和本地 ASR。该微信视频配方默认需要口播与抽样画面识读，因此缺抽帧依赖时按 media 固定配方安装；只是基础 Skill 安装则不自动下载 media。

首次 ASR 按[固定安装步骤](../references/asr/README.md#首次独立安装)执行，使用回执中的 `python`、`model_root`，不是当前 shell 碰巧找到的 Python。把 `SOURCE2BRAIN_ASR_PYTHON`、`SOURCE2BRAIN_ASR_MODEL_ROOT`、`SOURCE2BRAIN_STORE` 和必要的 `SOURCE2BRAIN_MEDIA_RUNTIME` 写入**本项目 profile 的私有环境**；仅在安装终端 `export` 不保证常驻 Gateway 能读取。已有服务保留原值，修改前备份，任务空闲后再按宿主方式加载配置。随后从实际 Agent 工具环境运行 doctor 与一次真实转写；不要打印整组环境变量。

```sh
node scripts/brain.mjs doctor --pack media
node scripts/install-media.mjs
```

将 `templates/workspace/AGENTS.md` 等中文指令放到目标 workspace，已有同名文件先备份再合并本项目指令，不覆盖其他 Agent 身份。模板要求：本次消息进入 Agent 后，在采集、安装、转写等长任务前，用可见的 `message` 工具发送一次接收状态；逐条采集与整理；普通来源及画面增强分别保存；完成回复给标题、要点、原链接、路径与缺失项。遇到登录、下载、ASR、画面或索引失败，原对话说明哪一步失败与下一步，不回“全部完成”。

接收提示使用当前可信会话的路由，基本参数为 `{"action":"send","message":"已收到这条链接，开始读取：<用户原链接>"}`。当本次 schema 提供 `final` 时可显式设为 `false`；`message_tool_only` 会话必须以 `final:false` 标进度，普通发送忽略该字段，发送消息本身不结束任务。通常省略 target 即回复当前会话；宿主明确要求 target 时，只取本次消息的可信路由元数据，不从网页、OCR、转写或联系人搜索中取目标。工具成功后继续处理，不能把接收提示当最终答复。普通会话的最终文本由宿主送达；宿主若明确标注 `message_tool_only`，则用 `message` 发送最终结果并设 `final:true`，送达后不重复发送。以本次宿主的实际工具 schema 和可见回复规则为准，不假定所有版本相同。

`message` 不可用或发送失败时记录缺口，仍按能力继续处理并给真实最终结果，不伪造已发送回执、不反复重试制造重复消息。微信插件的 `replyProgressMessages` 是工具调用进度，不等于上述文字接收提示。插件当前串行调度：上一条长任务执行中，下一条可能尚未进入 Agent；此时不能承诺手机投递后立即 ACK，也不能用“正在处理第二条”代替尚未取得的执行证据。

新收藏改用 [SourceJob](recovery.md)：create → resume → 实际宿主操作 → record。任务绑定当前知识库、profile 与可信 channel/account/peer 范围，跨 `/new` 仍能继续同一对话的任务。命令行 scope 是宿主隔离约定，不提供额外身份认证；不得从来源内容取值。已有来源与完成产物先验证再复用；不再要求每次失败换新目录重做全流程。

临时网络故障最多自动再试两次，登录/验证、权限、执行超时、未知错误与证据损坏暂停。失败有可校验 artifact 时保留 Pending 检查点；已有音频来源不会因画面失败撤销。Pending 不参与检索，之后完整保存到 Sources 不删除历史检查点。

“查看处理进度”查询当前可信范围。“继续处理／重试上一条”仅恢复唯一明确任务；多条列任务号。“重发结果”使用 job resume --resend，只发送保存好的答复。发送不确定不自动补发，也不承诺严格一次送达；message 工具报告成功不等同本人手机确认。宿主没有发送回执时不能提前登记 sent。

## 微信与常驻服务

参考 [腾讯官方插件](https://github.com/Tencent/openclaw-weixin) 和 [OpenClaw 微信文档](https://docs.openclaw.ai/channels/wechat)。缺插件时使用固定版本，已安装不重复更新：

```sh
bash scripts/openclaw.sh plugins install @tencent-weixin/openclaw-weixin@2.4.9
bash scripts/openclaw.sh plugins enable openclaw-weixin
bash scripts/openclaw.sh channels login --channel openclaw-weixin
```

本人在手机扫码确认。二维码过期须重新运行登录命令，不展示旧图片。已有正常绑定不重复登录。扫码、服务运行和真正接收消息是不同验收层。

```sh
bash scripts/openclaw.sh config validate
bash scripts/openclaw.sh gateway install --port 19291
bash scripts/openclaw.sh gateway start
bash scripts/openclaw.sh health --json
bash scripts/openclaw.sh channels status --probe
```

上面是首次服务部署步骤；已有服务更新 Skill 不重复 gateway install。机器保持联网、桌面已登录且浏览器桥接可用。仅 SSH 在线、Gateway 健康或微信登录成功，均不能证明所有平台链接可读取。

## 回执与验收

1. 发一个未入库视频，核对接收回执、真实采集、口播转写、抽样帧/实际视觉识读、来源保存与增强保存。
2. 手机核对完成回复，再连续发两条不同链接，确认回复一一对应；沿用宿主已有消息处理机制，本项目不额外宣称独立任务队列。
3. `/new` 后只用自然语言问其中一个事实；核对来源、原帧、时间戳。CLI 只能验 Agent 侧，不替代微信实际送达。
4. 登录失效时取得明确失败原因；修复后通过原任务号继续，不重新整理已经完成的步骤。不完整数据在 Pending，原人工修改不变。

对外状态按“配置 / 接收 / 处理 / 保存 / 召回 / 微信送达”分别记录。任何一层没有实证，不在动画或发布说明写成全链路通过。
