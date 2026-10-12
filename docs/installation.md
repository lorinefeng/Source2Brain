# 安装与排障

本页随 v0.2.0 完整 Skill 包交付。真实验证范围以 [验证矩阵](v0.2-validation.md) 为准，主要运行实测环境为 macOS arm64。选择下面一条入口，安装过程由已有 Agent 执行；平台登录、模型授权和微信扫码仍由本人完成。

## 两条入口

| 需求 | 路线 | 需要安装什么 |
| --- | --- | --- |
| 在现有 Agent 里收藏、检索 | [Hermes](../references/hosts/hermes.md)、[OpenClaw](../references/openclaw.md)、[WorkBuddy](../references/hosts/workbuddy.md) | 完整 Source2Brain Skill；按实际需求补 Node、采集、ASR 或 media |
| 手机微信发链接，电脑常驻处理 | [微信常驻配方](wechat-recipe.md) | 独立 OpenClaw profile 和腾讯微信插件；复用已有环境和绑定 |

不要仅复制 SKILL.md。发行包中的 `scripts/`、`lib/`、`references/`、安装文档和模板必须保持相对位置。下载实际发布版本的完整 Skill 包并核验 SHA256SUMS；候选包不能冒充已公开发布的版本。

源码和解包后的完整 Skill 均可执行：

```sh
node scripts/brain.mjs --help
node scripts/package-skill.mjs
```

基础 CLI 需要 Node 22+，media 与本项目常驻配方使用 Node 24+。Skill 打包、安装和 doctor 不会自动下载全部扩展。

## 可以直接交给 Agent 的提示

> 请阅读 Source2Brain 的 README、SKILL.md 和当前宿主接入说明，安装完整 Skill。先确认实际执行电脑，检查并复用现有模型、Node、浏览器采集和本地转写能力，只按需求安装缺失部分。知识默认保存在 ~/SecondBrain，也可使用我明确指定的目录。不要修改其他 Agent 的模型、密钥、默认 profile 或知识库。平台登录由我在执行电脑的浏览器完成。安装后用一条真实链接验证保存，再开独立新会话查回来源；逐项说明成功和缺失。若我选择微信入口，再执行独立 OpenClaw 常驻配方。

## 1. 检测运行环境

确认 Agent 的执行机器、桌面会话、Node/Python 路径与知识目录。SSH 的 PATH 可能不同，不要因找不到命令就重装整个环境。

```sh
node --version
agent-reach doctor --json
opencli --version
python3 scripts/install-asr.py --check
node scripts/brain.mjs doctor --pack media
```

ASR 检测读取 `SOURCE2BRAIN_ASR_PYTHON` 和 `SOURCE2BRAIN_ASR_MODEL_ROOT`；未设置 Python 就报告缺失，不猜测哪个共享环境可以修改。每一层分别验证：命令存在、桥接可用、实际平台读取、完整媒体、真实转写、保存、检索、消息送达。

## 2. 平台账号与浏览器

按 [Agent Reach 上游安装指南](https://github.com/Panniantong/Agent-Reach/blob/main/docs/install.md) 与 [OpenCLI 官方说明](https://github.com/jackwener/opencli) 检查并配置。已有工具先复用；实际采集支持范围以 [采集路由](../references/routing.md) 为准。

在运行 Agent 的电脑上保持可用 Chrome 桌面会话和 OpenCLI 浏览器桥接，在该浏览器登录小红书、抖音等实际要读取的平台。建议使用自己的专用小号，减少工作账号与自动化操作混用。OpenCLI 是复用浏览器登录的工具，不是平台账号；无需把 Cookie、二维码授权或密码贴进聊天。

体检中的桥接 `warn` 不等于失败，也不等于平台已登录。用用户给出的公开链接进行一次只读采集才证明访问可用。登录失效或验证码出现时请本人在浏览器处理，不能通过更换用户凭据或绕过风控伪造成功。

```sh
node scripts/brain.mjs capture \
  --message '用户完整分享文本' \
  --out "$HOME/.local/share/source2brain/captures/first-check"
```

输出目录必须新建。初始 artifact 为 partial，不能仅凭标题、配文或下载成功标为收藏完成。

## 3. 视频口播转文字

使用 [本地 ASR 固定配方](../references/asr/README.md)。它沿用 FunASR/Paraformer，不要求用户改用另一模型；已有可用环境只读复用，新环境进入独立目录。

```sh
python3 scripts/install-asr.py --check \
  --reuse-python '/已有环境/bin/python' \
  --model-root '/已有模型/iic'
```

返回包导入与模型文件检查，不等于真实转写。明确需要视频整理、确认缺失后再按 ASR 页执行 `--install`；推理过程中不自动下载模型或上传媒体。

将输出的 Python 和模型根目录配置到宿主环境：

```sh
export SOURCE2BRAIN_ASR_PYTHON='/实际运行环境/bin/python'
export SOURCE2BRAIN_ASR_MODEL_ROOT='/实际模型根目录/iic'
node scripts/brain.mjs transcribe --artifact '/采集目录/artifact.json'
```

输出 `artifact-transcribed.json`，仍需 Agent 根据真实转写整理摘要、逐字引文和限制。转写失败不使用配文冒充口播。既有转写可以用 `--from` 复用。

## 4. 视频画面与存储

普通 Skill 安装不附带 media。选择微信视频整理配方或明确要求画面信息时，按 [media 配方](../references/extensions/media.md) 先检测、按需安装、抽取视频帧，再调用宿主实际可用的多模态能力。推荐原生多模态 Agent 作为常驻资源链接整理模型；文本主模型可接用户明确指定的视觉工具，模型及密钥仅放运行端私有配置。默认不安装 Tesseract、OCR 语言包或 VLM 权重。当前覆盖是抽样帧视觉识读，不是全片理解。图文笔记仍需读取全部图片，不能用视频抽帧流程替代。

成功来源保存在 `~/SecondBrain/Sources`，缺失材料进入 `Pending`。增强结果只追加到独立子目录，原笔记和人工修改保持不变。只索引 Sources，不把 Pending 放入宿主检索。

## 5. 宿主回读与验收

OpenClaw 使用配置好的 memory 搜索；没有可用 embedding 时明确为关键词检索。Hermes 等已有本地命令能力的宿主可以直接文件检索，不强制安装独立 RAG 服务。

```sh
node scripts/brain.mjs search --store "$HOME/SecondBrain" --query '主题 关键词'
node scripts/brain.mjs verify --store "$HOME/SecondBrain"
```

独立新会话只给自然语言问题，确认 Agent 实际搜索并读取正确来源。视频画面事实应同时返回原链接、帧路径和时间。只有当前会话记得答案不算召回通过；CLI 成功不算微信送达通过。

## 排障与恢复

| 现象 | 处理 |
| --- | --- |
| 桌面可用、Agent 找不到命令 | 在实际执行工具检查 PATH，使用探测到的绝对路径 |
| Node 已有但版本不足 | 保留原安装；只在项目独立 runtime 安装固定版本 |
| profile 的 workspace 不一致 | 读取真实配置，显式设置 SOURCE2BRAIN_WORKSPACE；不把安装默默转向另一个 Agent |
| 短链 HTTP 请求失败但浏览器能开 | 用 OpenCLI 已登录浏览器解析，不直接判定来源删除 |
| 登录页被当作标题 | 停止摘要，报告平台登录失效 |
| ASR 包可导入但无结果 | 核对模型文件、音轨及真实样本；包检查和转写验收分别记录 |
| Skill 更新失败 | 恢复 skills 之外的备份；保留知识、模型和浏览器登录 |
| 内容保存但搜不到 | 核对 store、Pending 状态、宿主索引及 search issues |

更新前备份目标 Skill 和本项目配置，不覆盖其他宿主。卸载只处理明确由本项目创建的目录；不删除共享依赖、原知识、模型或登录态。安装回执记录“复用/新装/缺失/待本人操作”，不宣称无人参与的一键安装。
