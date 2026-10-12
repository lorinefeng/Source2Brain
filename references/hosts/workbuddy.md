# WorkBuddy 本地 Skill 接入指引

状态：官方资料核对，尚未完成本项目实装验收；不提供市场连接器。核对日期：2026-10-07。官方入口：[技能页面与本地导入](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market)。

## 复制给 WorkBuddy

> 请帮我按官方本地 Skill 导入方式接入 Source2Brain，使用完整 Skill 包，不能仅复制 SKILL.md。先检查当前 WorkBuddy 是否能读取支持文件、执行本机 Node 命令和访问我指定的知识目录。复用当前模型和已有采集、浏览器、ASR 能力，按需求补缺口，不安装其他 Agent。平台账号由我在真正执行任务的电脑浏览器登录。安装后先验证 Skill 可见、CLI 可运行，再用一条真实链接保存并在新会话检索引用；缺少任何执行能力就说明限制，不把资料级接入写成实测通过。

## 官方界面路线

打开“技能 → 添加技能 → 上传技能”，选择本地完整技能包。导入后在“已安装”中确认启用，再让 Agent 检查 `scripts/brain.mjs`、`lib/`、`references/` 和安装资料是否齐全。[官方页面](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market) 描述本地包导入与启用，但未给出足够精确的压缩格式和本地 CLI 执行契约；因此本项目不宣称某个 tar.gz/zip 已在 WorkBuddy 实装通过。客户端不接受当前归档时，按其文件选择器要求导入，不猜私有安装目录。

完整包可来自实际发行版，或执行 `node scripts/package-skill.mjs` 生成目录。保持 SKILL.md、脚本、lib、references 相对位置。后续按 [共用安装指南](../../docs/installation.md) 准备运行端登录态与工具。

## 逐层检查

1. Skill 可见并启用；关闭只停止自动调用，不等于卸载文件。
2. 确认命令在哪台机器执行，不能假设云端直接拥有本机 Chrome 登录态。
3. Node、OpenCLI、Python 和知识目录在同一可达环境；基础 CLI 与可选能力分开检测。
4. 完整来源保存 Sources，不完整来源保留 Pending；真正执行文件搜索与回读后再回答。
5. 记录实际客户端、系统、版本和成功范围，再更新 [验证矩阵](../../docs/v0.2-validation.md)。

本轮优先本地 Skill，不制作 MCP 服务或市场连接器。官方 [连接器规范](https://open.workbuddy.cn/docs/connector) 留作后续发布参考，不能替代上述本地导入流程。微信仍是独立 OpenClaw 参考配方，不暗示本项目已完成 WorkBuddy 微信验收。
