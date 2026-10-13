# 失败与恢复：SourceJob v1

本文对应 v0.3 恢复接口。任务记账不增加队列或后台服务，不替换宿主模型。真实验收与发布门槛见[可靠性验证](v0.3-validation.md)。

## 用户怎么用

微信中说“查看处理进度”“继续处理”“重试上一条”或“重发结果”。Agent 只查询当前知识库、profile、可信对话的任务。有多条未完成任务时列出标题、链接和任务号，不猜用户指哪一条。

网络临时故障最多自动再试两次。登录失效、平台验证、权限、无音轨、执行超时、未知故障和证据损坏直接暂停。电脑重启不会主动恢复；再次要求继续后检查并复用有效结果。回复送达不确定不自动补发；“重发结果”只发送保存好的答复，仍可能重复送达。

典型回复：

> 这条视频的口播已保存，画面识读暂未完成（VISION_UNAVAILABLE）。视频、转写和已读的 3 帧已保留。恢复视觉工具后说“继续处理”，我只补未完成的帧。

“已保存”“已检索命中”“工具报告发送成功”“手机已确认收件”是不同状态。接收提示也不代表完整处理结束。串行宿主中尚未进入 Agent 的消息不能承诺立即收到接收提示。

## CLI 与宿主协作

以下命令统一输出 JSON。`--store` 必须指向当前唯一知识库。`--scope` 必须来自宿主可信路由，建议组合 channel/account/peer；跨 `/new` 保持同一个对话对象范围，不能使用每次变化的 session ID、网页或转写提供的对象。命令行 scope 是宿主的隔离约定，不是密码或独立安全认证；本机 Agent 的文件权限仍由宿主管理。

```sh
node scripts/brain.mjs job create --store ~/SecondBrain --profile source2brain \
  --scope 'trusted-channel:account:peer' --message '用户原分享文本与单个链接' --requirements video
node scripts/brain.mjs job list --store ~/SecondBrain --scope 'trusted-channel:account:peer'
node scripts/brain.mjs job status --store ~/SecondBrain --scope 'trusted-channel:account:peer' --id job-000000000000000000000000
node scripts/brain.mjs job resume --store ~/SecondBrain --scope 'trusted-channel:account:peer' --id job-000000000000000000000000
```

`requirements=video` 表示视频口播与抽样画面文字；`audio` 是用户明确只要口播。多图笔记无论此选项都须实际读完全部图片。基础命令不自动安装 ASR/media/视觉模型；缺依赖时查固定配方，安装后继续原任务。

`resume` 执行确定性工具，直到需要宿主实际识读、整理、检索或回复。返回 `next_action`，其中 `action_id` 是该次操作令牌，`task_directory` 是私有产物位置。宿主完成真实操作后，将 JSON 写入该任务目录中的 `output`（未指定时自建普通 JSON 文件），然后登记：

```sh
node scripts/brain.mjs job record --store ~/SecondBrain --scope 'trusted-channel:account:peer' \
  --id job-000000000000000000000000 --action-id '返回的 action_id' --result '/任务目录/本次结果.json'
```

登记后会继续执行并返回下一项操作，循环直到完成或暂停。不按原任务目录写文件、不更改已完成产物；结果令牌过期则拒绝登记，不用迟到结果推进另一帧。遇临时宿主错误，登记失败结果后遵守返回的 `retry_after_seconds` 再执行新令牌对应的操作，同一帧/步骤一轮最多三次。自动重试不得再叠加宿主自己的无上限循环。

### 宿主结果格式

- **vision**：`{unit_id,input_sha256,vision}`。`vision` 包含 `status:"complete"`、逐字 `text`、必要 `description` 和 `reviewer`。后者必须包含 `identity`、真实 `model`（未知用 null）、`tool`、`visual_input_received:true`、ISO `reviewed_at`。实际看图后没有文字也可成功登记；失败或未读的图片不能写成已完成。
- **organize**：完整 SourceArtifact v1。不得修改采集配文或转写；视频原来源明确音频范围。多图的 `visual_notes` 固定逐页拼接为 `[page-1]\n逐字原文\n\n[page-2]\n逐字原文`，页序沿媒体清单，不按结果登记顺序重排；必要视觉描述保留在逐页记录，不能当作文字引文。使用实际模型名。
- **enhancement**：在 `next_action.input` 草稿上补知识与真实整理记录，保持 source、parameters、frames 原样；在同一帧目录保存，遵守 SourceEnhancement v2 引文校验。没有可靠新增文字事实时保留 partial 并登记 `NO_VISUAL_FACT`，音频成果不会被撤销。
- **index**：`{tool,query,matched_paths,read_paths}`，必须来自真实工具调用，命中并读取当前知识库的本条来源。文件检索不能称语义检索。
- **prepare_reply**：`{text}`，包含无跟踪参数的原链接、保存/检索状态、摘要与覆盖缺口；仅准备，不发送。
- **reply**：实际发送后登记 `{status:"sent",tool:"实际消息工具名"}`；无法判断是否送达用 `status:"uncertain"`。sent 仅表示宿主工具报告发送成功，不是手机确认。
- **失败**：`{ok:false,code:"明确错误码"}`；HTTP 临时错误可带数值 `retry_after_seconds`。不填写猜测错误码，不附凭据或完整工具输出。

回复动作一经交给宿主就记录 in_flight。如果中途退出，下次继续不会再次发送，而是标记 uncertain。只有用户明确要求补发时调用 `job resume ... --resend`，读取返回的 `reply_file` 中 text 在当前可信对话发送，再登记结果。普通宿主自动送达最终文本时，也应在可取得发送回执后登记；没有回执则保持未确认，不能提前写 sent。

## 检查点与保护

任务位于 `.source2brain/jobs/<任务号>/`：完整状态原子发布；产物记录哈希；每帧/页识读独立落盘。任务目录、Pending 和诊断不进入检索，不随发行包分发。状态里原链接可能带平台访问参数，因此运行目录保持私有；公开报告只放规范链接与白名单错误信息。

成功下载的附件不会因为另一个附件失败被重下。临时媒体地址失效重新读取同一来源，候选切换与网络重试共用每附件三次预算。下载中断不承诺字节断点续传；ASR 中断不承诺音频分段续跑，只复用完整转写。

同来源保存与增强保持原子发布和重复保护。保存完成、任务状态未更新时，恢复重新确认 duplicate；不覆盖人工 Markdown。新的增强要求独立追加；内容变化、缺失附件、哈希不一致时暂停，不为让检查通过而修改旧证据。

任务锁不按年龄抢占；只回收能证明已退出的本机持有者。电脑或 Agent 被强制结束后，旧工具可能仍运行：若发现子进程组仍存在则暂停，等待结束或由维护者核实停止；不猜 PID 身份、不并发启动第二次昂贵处理。无法确认的锁或孤立媒体交给维护者审阅，不自动删除用户资料。

## 错误对照

| 类别 / 例子 | 处理与继续方式 |
| --- | --- |
| HTTP_408 / HTTP_429 / HTTP_5xx、明确网络连接中断 | 最多三次总尝试，2 秒、8 秒退避；Retry-After 支持秒数或 HTTP 日期，等待最多 60 秒。耗尽后保留任务，网络恢复后继续 |
| AUTH_REQUIRED / SECURITY_BLOCK / SIGNED_URL_REQUIRED | 本人登录、处理验证或提供有效分享链接；不清空浏览器或重新绑定微信 |
| ASR_UNCONFIGURED / ASR_MODEL_MISSING / MEDIA_DEPENDENCY_MISSING | doctor 与固定安装配方；复用现有配置，补齐后继续 |
| NO_AUDIO / EMPTY_TRANSCRIPT / VISION_UNAVAILABLE / NO_VISUAL_FACT | 说明缺口，保留媒体、口播和已读图；不能生成完整成功摘要 |
| COMMAND_TIMEOUT / MEDIA_TIMEOUT / ASR_FAILED / INVALID_TOOL_OUTPUT | 暂停，排查耗时、资源或工具输出；不连续重跑长任务 |
| CHECKPOINT_CHANGED / SOURCE_CHANGED / UNSUPPORTED_CLAIM / UNSAFE_PATH | 停止复用，不覆盖旧知识；核对原资料、证据或来源差异 |
| TASK_LOCKED / COMMAND_STILL_RUNNING | 确认原执行者/工具已结束后继续；不靠删锁强行并发 |
| INDEX_NOT_VERIFIED | 来源可已保存，仅修复索引并真实回读 |
| DELIVERY_UNCERTAIN | 已保存答复；用户要求“重发结果”后补发，不重新采集 |

## 更新与恢复旧版

更新前备份完整 Skill、workspace 指令与项目 profile 配置；等已有任务空闲后再更新。出现运行问题时恢复旧 Skill 和指令，不删除新任务记录或来源证据。旧版能继续读取原知识，但不能管理 SourceJob；切回新版后再继续。任务不会因回滚而自动重跑。
