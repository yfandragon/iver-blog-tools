# 下一开发会话交接提示词

请在 Codex 中打开项目 `/Users/duanyifan/Environment/project/iverBlogTools`，并先完整阅读 `AGENTS.md`、`README.md`、`docs/PROJECT_CONTEXT.md`、`docs/product/spec.md`、`docs/product/discussion.md`、`docs/adr/`、`docs/research/model-capability-audit.md` 和 `docs/testing/cli-image-validation-2026-10-26.md`。这些文档记录了需求、决定、实测证据和未完成边界；不要把旧时间线里的暂定意见当作当前决定。

我准备在这个独立项目里开发自己的本地创作工具。首版目标支持 Codex CLI 和 Antigravity CLI：导入外部写好的Markdown、生成文章封面、预览目标博客的真实呈现，并在作者确认后将明确差异提交到使用者选择的博客仓库。作品和首页背景以后扩展。每个功能使用自己的基础提示词；本次提示词可改，但不能覆盖原版。正文不重写、不自动插图，也不生成 `quickReference`。

请从当前Git状态开始，先核对目录/源码与文档是否一致，再给出适合空项目的最小技术架构和分阶段实现方案，说明每阶段的文件范围、输入输出、验证方式和停止点。技术栈尚未决定，请基于当前目标提出建议，不要臆造已有程序、API、认证或图片回收能力。方案形成后，在本仓库推进实现；对未决的UI细节做可逆选择并记录，只有影响安全、许可或数据丢失的决定才询问我。

Antigravity是明确目标，但有前置许可门槛：官方FAQ称第三方软件/工具访问Antigravity可能违反服务条款，且消费者计划不支持在第三方应用中包装 `agy`。本地工具会通过服务调用CLI，所以请先确认拟使用的计划和调用方式是否被允许；不要读取认证文件、轮换账号或绕行限制。如果无法确认许可，不要调用Antigravity，也不要让Codex停工：实现提供商边界和Codex链路，Antigravity保持未启用并把许可结论列为阻塞项。当前实测只有 `gemini-3.8-flash-high` + 原生 `image-generator` 子代理一条路线，后续必须等待子代理完成并实际取回可解码图片。

先只读检查首个目标仓库 `/Users/duanyifan/Environment/project/iverBlog`：重读其 `AGENTS.md`、文章schema/卡片、文章发布流程、封面规则；不要修改该仓库。然后在 `iverBlogTools` 里设计接入边界，使预览/输出可以指向使用者自己的目标仓库。文章预览与目标博客文件修改的差异必须清晰可审查；不要自动提交、推送或部署，除非我在那次发布任务中明确授权。

成功标准是先形成可以审查的实现方案，再完成有验证的最小可运行切片；报告哪些功能已跑通、哪些只有设计/静态验证、哪些仍受许可或环境限制。不要仅凭CLI退出码或模型文字宣布图片生成成功，也不要把测试图放进博客素材。
