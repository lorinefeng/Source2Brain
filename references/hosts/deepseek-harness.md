# DeepSeek Harness 官方接入资料

状态：资料核对，未实装。日期：2026-10-01。Harness 宿主与 DeepSeek 对话模型是两个不同层次。

- [官方产品入口](https://deepseek.com/harness/en/)
- [Skills 中文源码文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.zh.md)
- [MCP 中文源码文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/mcp.zh.md)
- [官方仓库](https://github.com/deepseek-ai/deepseek-harness)：当前安装、配置和权限说明以仓库为准。

官方 Skill 本地发现包含项目 `.dsh/skills`、`.agents/skills` 和用户级根目录；包使用 `source2brain/SKILL.md`，不要多套一层分类目录。由用户 Agent 确认当前 dshHome、agentsHome、执行环境和作用域，再安装完整包。

Source2Brain 没有 DSH 专用插件或 MCP Server。优先复用本机 Skill + CLI，明确授权知识库目录，并以 Sources 文件关键词检索验证回读。MCP 是备选工具协议，不会自动提供采集登录态或持久记忆。

如果找不到 Skill，检查根目录、包名、嵌套层级和更高优先级同名项；如果无法运行脚本，核对 Node、沙箱和路径映射。源码持续演进，用户 Agent 应以所安装版本的官方文档复核，不能只照搬本文。
