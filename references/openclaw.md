# OpenClaw 接入与召回

资料核对：2026-10-07。[官方 Skills](https://docs.openclaw.ai/tools/skills)、[配置](https://docs.openclaw.ai/gateway/configuration)、[memory 搜索](https://docs.openclaw.ai/concepts/memory)。当前参考配方固定 OpenClaw 2026.9.6；新版配置字段须按实际 CLI 检查，不直接套用滚动文档。实测层级见 [验证矩阵](../docs/v0.2-validation.md)。

## 复制给 OpenClaw

> 请在当前明确选定的 OpenClaw profile/workspace 安装 Source2Brain 完整 Skill，保留现有模型和其他配置。先检查 Node、采集工具、浏览器登录、本地 ASR 与知识目录，按需求安装缺失能力。视频要口播文字和抽样画面证据。完成保存后仅把 Sources 加入检索，检验索引实际命中，再开独立新会话只用自然语言查回来源。若我需要微信 ClawBot，再按可选常驻配方配置；本人完成扫码，已有绑定优先复用，不能启动第二个服务竞争它。

## Skill 与 profile

从完整发行包或 `node scripts/package-skill.mjs` 取得目录，使用官方本地安装入口：

```sh
openclaw --profile source2brain skills install '/完整Skill目录' --as source2brain
```

如果更新已有目录，先在 Skill 加载路径之外备份，再使用 `--force`。确认实际加载的 workspace 与 profile，一次只针对用户明确选择的环境；不要误装到另一个 Agent。

本项目 wrapper 默认 source2brain，设置 `SOURCE2BRAIN_PROFILE` 可使用隔离测试 profile；配套 workspace/端口/知识目录也应隔离。首次安装见 [安装指南](../docs/installation.md)，微信见 [常驻配方](../docs/wechat-recipe.md)。普通使用不要求微信插件。

## 复用原生视觉，或配置用户指定的视觉工具

原生多模态 Agent 已能实际调用 `view_image` 时，直接做样本验证，不增加 provider。主聊天模型只有文本能力而用户明确给出 OpenAI 兼容视觉服务时，可为当前 profile 配置独立 `imageModel`，保留 `agents.defaults.model`。不要猜端点、模型名或复制维护者私有配置；普通对话成功不能证明服务接受图片。

以下字段在 OpenClaw 2026.9.6 实装核对。先查本机同版本 `docs/concepts/model-providers/custom-providers.md`、`docs/gateway/secrets/secretref-contract.md` 及当前 schema；官方网页入口为[模型提供商](https://docs.openclaw.ai/concepts/model-providers)和[SecretRef](https://docs.openclaw.ai/gateway/secrets/secretref-contract)。备份目标 profile 配置及私有文件，只合并本次字段，不打印完整配置。

1. 复用用户指定的私有凭据文件；新建时使用 0700 目录、0600 JSON 文件，内容为 `{"api_key":"实际密钥"}`，由运行端安全输入或现有配置转移。密钥不填进补丁、CLI 参数或聊天。
2. 用实际 provider/model ID、用户端点和私有绝对路径替换下列占位符。已有同名 provider 时保留其他模型与字段，不照抄覆盖数组。

```json
{
  "secrets":{"providers":{"source2brain-vision-secret":{"source":"file","path":"<运行主机的私有JSON绝对路径>","mode":"json"}}},
  "models":{"providers":{"vision-provider":{
    "baseUrl":"<用户明确给出的OpenAI兼容端点>",
    "apiKey":{"source":"file","provider":"source2brain-vision-secret","id":"/api_key"},
    "api":"openai-completions",
    "timeoutSeconds":180,
    "models":[{"id":"<实际视觉模型ID>","name":"<实际模型名>","reasoning":false,"input":["text","image"]}]
  }}},
  "agents":{"defaults":{"imageModel":{"primary":"vision-provider/<实际视觉模型ID>"}}}
}
```

3. 上下文窗口、输出上限和 reasoning 按真实模型能力填写，不靠示例猜测。若当前 `agents.defaults.models` 已设模型白名单，还须在原映射添加该 `provider/model`，保留其他项。`coding` 在此版本包含 `view_image`，不要改成 full 或移除既有 deny；受策略限制时报告缺口。
4. 保存已替换占位符并合并旧字段的私有补丁，通过本项目 profile wrapper 应用：

```sh
bash scripts/openclaw.sh config patch --stdin < '/私有目录/实际合并补丁.json'
bash scripts/openclaw.sh config validate --json
bash scripts/openclaw.sh secrets reload --json
```

5. 配置和 reload 成功只证明配置层。用独立会话把真实图片交给 `view_image`，只要求逐字转录、必要可见描述及不确定处，不猜应用或画面来源。核对真实工具输出、模型名、输入 SHA256 与关键文字，之后才能记入 v2 的逐帧 reviewer。失败保留 Pending，不自动换供应商或退回 OCR。

本次路径经验：知识库图片可能被宿主本地媒体路径限制拒绝。不要扩大允许范围；将已核验图片原始字节复制到当前 profile 已允许的 workspace 专用目录（0700，文件 0600），逐一对比前后 SHA256，再把副本交给图像工具。记录原路径、输入路径和相同哈希，原知识帧保持不变。复制成功本身不证明模型已识读。

## 索引与回读

OpenClaw 2026.9.6 的配置位于顶层 `memory.search`。`memory.search.extraPaths` 仅添加知识库 Sources 的绝对路径，不添加 Pending、采集缓存或审计资料，不覆盖原有路径。

```sh
bash scripts/openclaw.sh config validate
bash scripts/openclaw.sh memory status --deep
bash scripts/openclaw.sh memory index --force
bash scripts/openclaw.sh memory search '来源主题'
```

复用已有 embedding。首次确需本地语义检索时，可按本项目已验证配方使用 `@openclaw/llama-cpp-provider@2026.9.6`，只选择 embedding（EmbeddingGemma 300M Q8），跳过聊天模型下载，不替换用户现有对话模型：

```sh
bash scripts/openclaw.sh plugins install @openclaw/llama-cpp-provider@2026.9.6
bash scripts/openclaw.sh config set memory.search.provider local
bash scripts/openclaw.sh models auth login --provider llama-cpp --method local
```

需要实际 `embeddingProbe.ok=true` 与检索命中才能声明语义可用。`provider=none` 是关键词模式；先记录这个范围，不把它写成语义验收。

新会话用独立 session key，只给自然语言问题，不给来源正文、URL、路径或答案。检查 Agent 检索、读证据并引用原链接。画面事实额外核对帧文件与秒级时间戳。微信需该通道真实投递和手机送达证据，CLI 对话不等价于微信通过。

当前 profile 的 Gateway 已常驻运行时，CLI 验收通过该 Gateway 发起独立会话，不加 `--local`，也不加 `--deliver`。OpenClaw 2026.9.6 会拒绝在同一状态目录已有 Gateway 时启动嵌入式 `--local`；不要为一次回读停止现有微信服务。使用新的 `--session-key`（如 `agent:main:source2brain-recall-<本次UUID>`）与新的 `--session-id`，保留实际工具轨迹及回答，不能续用刚收藏的微信上下文。

宿主 memory_search 可能命中 workspace/dreaming 或会话记忆。只接受当前知识库 Sources 内的候选，提取来源 ID 后执行 `brain.mjs read --source-id ... --store ...`，应用有效事实与勘误再引用，不能直接使用旧索引摘要。

配置或 Skill 更新失败，恢复目标 profile 备份；知识库、人工修改、共享模型及登录态保留。
