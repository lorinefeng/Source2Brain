# WorkBuddy 官方接入资料

状态：资料核对，未实装，未发布连接器。日期：2026-10-01。

先读 [官方连接器规范](https://open.workbuddy.cn/docs/connector) 的“选择接入方式”“Skill 文件”“认证与凭证”“提交前检查”。这是连接器发布规范，不证明所有客户端都能直接使用任意本机 Skill 目录。

当前 Source2Brain 交付 Skill + 本地 Node CLI。让用户 Agent 先核实当前客户端是否能读取完整 Skill 并执行本机命令；具备这些能力时再按共用流程操作。缺少执行入口就报告缺口，不猜安装路径或 MCP 包名。

未来若制作 WorkBuddy 连接器，官方要求在 MCP + Skill 和 CLI + Skill 中选择一种，不在同一连接器混用。CLI 路径要求成熟的跨平台工具；Source2Brain 尚未做 Windows/Linux 采集实测，因此首发不提交这一连接器。MCP 路径需要实际服务和清晰的工具契约，也不在本轮增加。

排障先区分：连接器是否安装 → Skill 是否可见 → 本机或托管执行环境 → Node/浏览器/ASR 是否同机 → store 权限 → 搜索回读。API 配置遵循宿主凭据机制，不放入 Skill 或 Git。参阅共用排障清单后仍有缺口，记录环境与脱敏错误，不能声称开箱即用。
