# OpenClaw 接入与召回

第一阶段使用独立 `source2brain` profile，命令前缀为 `openclaw --profile source2brain`。源码 Skill 安装到该 profile 的 workspace/skills 中；不要误装到另一个 Agent。

配置 `memory.search.extraPaths` 指向知识库的 `Sources` 真实绝对路径，仅索引成功来源。OpenClaw 2026.9.6 的设置位于顶层 `memory.search`；不要照抄旧版本 `agents.defaults.memorySearch`。

```sh
openclaw --profile source2brain config validate
openclaw --profile source2brain memory status --deep
openclaw --profile source2brain memory index --force
openclaw --profile source2brain memory search '来源主题'
```

embedding 必须实际可用才能声明语义检索。`provider: none` 仅为明确的关键词模式，不能作为语义验收证据。第一次配置本地 embedding 需要下载模型与运行时，应记录版本和真实可用状态。

新会话验收必须使用独立 session key，在提示里只给自然语言问题，不带来源正文、笔记路径、URL 或答案，检查 Agent 是否先检索、读到正确原链接并引用。微信验收还需来自微信的真实消息和该通道的成功回执；CLI 对话不等价于微信验收。
