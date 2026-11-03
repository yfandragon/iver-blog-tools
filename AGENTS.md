# IverBlog Tools 工程协作规则

## 开工前必读

1. `README.md`
2. `docs/PROJECT_CONTEXT.md`
3. `docs/product/spec.md` 与 `docs/product/discussion.md`
4. `docs/adr/` 中的架构决定
5. `docs/research/model-capability-audit.md` 与 `docs/testing/cli-image-validation-2026-10-26.md`

## 项目边界

- 当前仓库只维护创作工具自身。IverBlog 是首个目标仓库，两者独立演进；除非作者明确要求，不要修改 IverBlog 文件。
- 工具生成的文章、图片、组件或配置应写入使用者选择的目标博客。工具仓库更新不能自动提交或推送目标博客。
- 不提交、推送、部署工具或目标博客，除非作者对该次具体发布明确授权。
- 文章正文由外部编辑器完成。导入时保留正文，不自动改写或插入图片；不自动创建 `quickReference`。
- 功能基础提示词必须是只读版本化资源；用户临时改动写入本次任务副本，不覆盖原版。

## CLI与图片结果

- Codex CLI 与 Antigravity CLI 使用独立适配器。区分提供商、推理模型、图像工具及实际图片产物。
- CLI退出码、成功文字或返回的 Markdown 图片链接都不能单独证明生图成功。必须取到文件并验证格式可解码，再交给页面预览。
- Antigravity现有证据仅覆盖 `gemini-3.8-flash-high` + 原生 `image-generator` 子代理。正式适配器需要追踪子代理完成状态，从 CLI 托管会话目录回收图片并校验。
- Antigravity官方FAQ指出第三方工具访问可能违反服务条款，消费者计划不支持在第三方应用中包装 `agy`。在确认允许的账号计划和调用方式前，不调用 `agy`。不得绕开限制、轮换账号或读取/暴露认证文件。
- 不把 `agy models` 返回的列表视为生图能力列表；模型可用性与各任务能力需分别记录。

## 变更与验证

- 先展示目标博客的 schema、封面关联及文章发布规则证据，再设计写入方式。
- 发布前显示精确文件差异，由作者确认后才允许目标仓库发布；本地预览不等于公开部署。
- 更新相关规格/过程记录，运行与变更相称的检查，并报告事实证据和未完成边界。
