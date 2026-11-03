# IverBlog Tools 项目上下文

更新日期：2026-10-28（Asia/Shanghai）

## 为什么有这个项目

这段工作从 IverBlog 的文章上传流程开始：作者已在外部编辑器写好 Markdown，希望导入后调用本机 AI 生图、预览博客实际效果，再确认写入和推送。讨论逐步明确，工具要有自己的代码仓库和本地操作页面；每位使用者启动自己的页面，使用自己的 CLI、登录状态和目标仓库。博客只保留公开介绍入口，普通静态页面不能替访客启动其本机程序。

独立项目路径采用作者已创建的 `/Users/duanyifan/Environment/project/iverBlogTools`，目录名 `iverBlogTools` 适合涵盖文章、作品、背景生成等多项功能；面向读者的名称暂定为 IverBlog Tools（作者工作台）。该目录先完成需求和设计文档迁移，2026-10-28 开始首个可运行切片实现。不会把工具操作页面或模型凭据放入公开博客。

## 目标与功能顺序

首条流程是导入 Markdown → 生成文章封面 → 使用目标博客真实预览 → 作者确认后准备目标仓库发布。正文保持外部编辑器的内容，不由工具重写，也不自动插入图片。已有标题、摘要、日期沿用；缺失字段给作者可编辑值，日期可选择和修改。新工具不新增或生成博客卡片的 `quickReference` 字段。

后续预留两类独立功能：作品材料与博客页面接入；首页背景候选生成/上传。首页背景使用博客现有专属提示词与场景规则，与单篇文章封面分开；可调整本次提示词，但不能覆盖原版。生成候选、本地接入、启用轮换与公开发布必须分阶段。

首版范围现纳入 Codex CLI 与 Antigravity CLI。OpenCode Go/DeepSeek 与 dsh 不在当前范围。选择功能、提供商和模型时，不混淆推理模型与图像生成工具；可聊天或读图并不自动表示可生图。

## 仓库、数据和发布边界

- 本仓库只保存创作工具源码、文档、提示词和版本；IverBlog 是首个目标仓库。
- 工具由各使用者在本机启动，每位使用者使用自己的 CLI/模型账号和目标仓库。
- 导入、生成、预览只准备目标仓库本地文件；工具不默认自动提交或推送。发布前显示精确差异，由作者明确确认。
- `iverBlogTools` 的提交/推送只更新工具项目，不触发 IverBlog Cloudflare 部署。对目标博客配置发布分支的推送才会触发其既有构建；历史机制记录见 IverBlog 的 `docs/deployment-log.md`。
- IverBlog当前文章关联方式是frontmatter的 `cover` 指向图片资源；开发时仍须重新核验当时的schema、卡片、详情页以及 [文章发布流程](../../iverBlog/.scratch/blog-evolution/article-publishing-workflow.md)。场景生图还须读 IverBlog 的 `background-scenes.md` 与 `background-generation.md`。不要把文档提案当成已实现源码。

## 首个可运行切片（2026-10-28）

- 工具使用 Node.js 22、TypeScript、React/Vite 与 Fastify。开发和生产服务都只绑定 `127.0.0.1`；页面使用同源会话令牌，API 还检查 `Host`、回环来源及同源请求。
- `src/server`、`src/client`、`src/shared` 分别放置本地服务、工作台界面和共享数据类型。Codex 适配器通过非交互 `codex exec` 生成摘要/封面，并从任务临时目录取回原图。摘要和封面进度通过 SSE 返回。
- Codex 模型目录使用官方 `codex app-server` `model/list` RPC；目录条目只标记为目录可见，不推断账户调用权限。只有此前实际验证过生图的 `gpt-6.1-sol` 被标记为封面能力已验证；底层图像模型名称不从推理模型推断。
- `prompts/article-cover/v2.md` 是当前默认的只读版本化基线，`v1.md` 保留；每个新导入任务会将当前提示词拷贝到任务临时目录，已有任务副本保持原样。导入过程保持 Markdown 正文内容不变，不写入 `quickReference`。
- 目标博客适配器拒绝不兼容的 Astro schema、已存在文章和无法解析的本地相对资源；只写入 `src/content/articles/` 新文章及 `src/assets/covers/` WebP。预览运行目标博客自己的 Astro 开发服务，显示首页和文章页地址。
- 发布确认检查完整差异、当前分支和推送目标，只暂存两项任务文件；如果目标仓库已有暂存改动、任务文件内容变化或文章冲突则停止。测试已用隔离 bare Git 远端核验提交/推送范围。
- Antigravity 仍是禁用占位状态。服务不会检测或启动 `agy`，直到账号计划及调用方式符合官方许可边界。

手动验收在临时 IverBlog 副本完成：浏览器可见真实首页卡片、文章页正文和 WebP 封面。没有对真实 IverBlog 写入、提交或推送。更多测试数据和边界见[首个可运行切片开发记录](./development-log.md)。

## CLI能力证据与限制

Codex CLI `0.163.0-alpha.11.2` 已实际生成PNG、取回并校验，也由临时本地网页读取显示；当时推理模型是 `gpt-6.1-sol`，底层图像模型未确认。证据和边界在 [CLI 实测记录](./testing/cli-image-validation-2026-10-26.md)。

Antigravity CLI `1.4.7` 的两次 Flash Low 直接调用没有图片；测试规则禁止委派。后来按作者截图路线使用 `gemini-3.8-flash-high`，委派原生 `image-generator` 子代理后，子会话调用 `generate_image` 并生成 1376×768 JPEG。模型档位和委派方式同时变化，无法隔离单一原因。父级 `agy -p` 返回等待文字而不是图片路径；适配器必须等待子代理完成，从 CLI 管理的会话目录定位、校验并回收图像。现有证据仅覆盖一个模型/代理组合。

**官方使用边界是硬门槛。** Antigravity官方FAQ说明第三方软件、工具或服务访问Antigravity可能违反服务条款，也说明 `agy -p` 虽用于直接脚本和CI，但消费者计划不支持将它包装在第三方应用内。当前工具设计恰好是本地应用调用 `agy`，不得默认消费者账号可用。开始集成前，必须确认所用计划及调用方式得到允许；在此之前只保留未启用的提供商接口或继续Codex，不得尝试绕行、账号轮换或复用第三方认证。依据：[Antigravity FAQ](https://www.antigravity.google/docs/faq)、[Headless CLI](https://www.antigravity.google/docs/cli/headless/)、[Subagents](https://www.antigravity.google/docs/subagents/)。

## 后续边界

- 当前只创建新文章；同名文章拒绝覆盖，更新已有文章的流程尚未设计。
- 本地相对图片保持原文引用，不自动从导入设备搬运；只有目标博客目录中能够解析的资源才允许预览准备。远程图片引用保留。
- 只接受当前 IverBlog Astro 结构；尚未适配任意 Astro schema 或其他博客框架。
- `model/list` 只用于呈现目录，不能证明所选模型具备账户权限。真实调用仍以 Codex 当前会话完成状态和产物验证为准。
- Antigravity 包装调用需先确认官方允许的计划与使用方式。此项未确认，不调用 `agy`。
- 文章之外的作品、首页场景、安装分发及博客公开工具入口未实现。
- 临时任务数据保存在系统临时目录内存任务记录，应用重启后不提供任务恢复。

## 需求、证据和实施的区别

[规格](./product/spec.md)记录当前已确认需求和未实现边界；[讨论记录](./product/discussion.md)保留需求决策时间线；[ADR](./adr/)记录稳定的架构决定；模型能力和CLI实测分别有独立证据文件。不要把上述实现测试扩大解释为目标博客已经发布或平台已经部署。
