# 开发记录

## 2026-10-28：首个可运行切片

### 实现

- 建立 Node.js 22 + TypeScript + React/Vite + Fastify 本地应用，统一通过 `npm run dev` 启动；服务绑定回环地址，并用本地会话、Host 和 Origin 校验保护 API。
- 完成文章 Markdown 导入、标题/摘要/日期补齐、SSE 进度、Codex 摘要草稿，以及 Codex 封面产物的文件回收、SHA-256、格式与全量解码、尺寸校验。
- 使用官方 Codex app-server `model/list` RPC 读取模型目录；目录可见性与模型账户权限、已验证的封面能力分开显示。目录读取失败时保留历史实测的模型作为待确认项。
- 添加只读版本化提示词 `prompts/article-cover/v1.md`。每篇任务使用系统临时目录内的副本，原版不被任务覆盖。
- 完成 IverBlog Astro 目标仓库适配、schema/路径/冲突/本地资源检查、Markdown 元数据和 `cover` 关联、WebP 封面生成、目标仓库真实 Astro 预览、首页/文章页链接及差异展示。
- 发布确认显示完整文本差异、封面校验信息、文件清单、分支和推送目标；只暂存本次文章与封面。目标仓库存在其他暂存更改、路径冲突或文件内容变化时终止。
- Antigravity 仅显示禁用状态，不检查或启动 `agy`。许可与计划限制未解除前不开放适配器。

### 验证与证据

- 运行环境：Node.js `v22.23.2`。
- `npm test`：8 项测试通过，覆盖 API 本地会话/同源门控、正文精确保留、元数据回退、相对图片解析、损坏图片拒绝、Astro 结构兼容、重复文章防覆盖、暂存隔离和精确推送。
- `npm run typecheck`：通过。
- `npm run build`：通过，生成 Vite 客户端和 TypeScript 服务端产物。
- 临时博客副本 `npm run check`：0 errors、0 warnings、0 hints；`npm run build` 成功，生成 6 个页面并完成 Pagefind 索引。
- 真实 Codex CLI 生成一张 PNG；服务完成全量解码并取得 1672×941 尺寸，前端通过本机服务显示图片。底层图像模型名称仍无法从产物确定。
- 临时 IverBlog clone 的真实 Astro 开发预览在浏览器显示了首页文章卡片、封面资源和文章页内容；正文与导入 Markdown 相同，未增加 `quickReference`。
- 自动化发布集成测试将只包含任务文章和封面的提交推送到本地 bare remote。临时副本中的 README 未暂存改动仍保留；README 已暂存时，发布操作在暂存任务文件前被阻止。
- 手动预览使用 `/private/tmp/iverblogtools-first-slice-acceptance-20261028/blog`；本地 bare remote 是 `/private/tmp/iverblogtools-first-slice-acceptance-20261028/publish.git`。测试远端与真实发布远端无关。

### 未完成边界

- 修复 Unicode Git 路径状态读取后，服务端精确暂存/提交/推送已由隔离 bare remote 集成测试覆盖。此次手动 UI 的发布尝试使用了修复前仍在运行的旧服务，因此没有完成手动点击后的完整推送验收；不能把自动化发布测试表述为该次 UI 手动发布成功。
- 本地相对资源只校验目标博客中已有文件，不自动迁移导入文件旁的图片。
- 仅支持已核验的 IverBlog Astro schema；不支持既有文章更新。
- `model/list` 返回目录不等于当前账号的实际调用授权。Codex 调用失败时不会切换到其他生图服务。
- 没有调用 Antigravity，也没有对真实 IverBlog 写入、提交、推送或部署。真实博客工作树既有的 `docs/development-deployment-log.md` 修改保持原样。
- 工具仓库原本没有提交；本次未暂存、提交或推送工具源码。

## 2026-10-28：文章封面默认提示词升级至 v2

- 按作者提供的三段原文新增 `prompts/article-cover/v2.md`；新导入任务的默认提示词和版本标识改为 `article-cover-v2`，旧版 `v1.md` 与已有任务副本保留。
- 同步 README、项目上下文、规格和讨论记录。当前运行的服务需要重启后才会载入新的服务端默认值；已导入任务不会自动替换提示词。
- 定向检查通过：v2 与作者原文逐字一致；实际调用 `createTask` 获得 v2 与独立 `prompt-copy.md`；修改任务提示词后，两版基线未变化，下一篇任务仍载入 v2。
- `npm test`：8 项通过；`npm run build`：通过，含 TypeScript 类型检查。测试期间 Vite 提示 HMR 端口已占用，测试 API 和断言仍全部完成。
- 此次未调用生图服务，未验证新提示词的实际出图、缩略图或裁切效果；未增加近期封面自动收集或构图自动验收功能。未修改真实目标博客，未提交、推送或部署工具/目标博客。
