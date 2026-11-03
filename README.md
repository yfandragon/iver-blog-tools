# IverBlog Tools（作者工作台）

独立运行在作者本机的文章创作工作台。支持导入 Markdown、HTML、文件夹和 ZIP 笔记包，补齐元数据、通过 Codex 生成并校验独立封面、写入兼容 Astro 博客的本地预览文件、查看真实博客预览和完整文件清单，并在作者明确确认后提交并推送本次文件。

工具仓库与目标博客相互独立。应用只绑定 `127.0.0.1`，浏览器使用同源本地会话访问 API。目标博客路径由作者输入；当前仅接受符合 IverBlog 内容约定的 Astro 仓库。应用不会自动改写正文、补插图片或创建 `quickReference`。

## 运行

要求 Node.js `22.12` 至 `22.x`、npm 和已安装并登录的 Codex CLI。Antigravity 保持禁用，不检查或启动 `agy`；官方许可和账号计划边界见[模型能力记录](./docs/research/model-capability-audit.md)。

```sh
npm install
npm run dev
```

打开终端显示的本机地址。关闭终端中的开发服务即可退出。运行生产构建可使用 `npm run build`，构建后用 `npm start` 启动本机服务。

## 使用流程

1. 选择 `.md`、`.html` 文件、包含笔记和资源的文件夹，或 ZIP。多个 Markdown/HTML 入口时先选择一个。HTML 标题按 `<title>`、首个 `h1`、文件名回退；摘要读取 `description` 或 `og:description`，日期默认本地当天。字段均可编辑。原始包保存在本机任务目录，资源清单会显示已解析、缺失、外链和阻塞项。
2. 选择已列出的 Codex 模型。目录由 Codex `app-server` 的官方 `model/list` 接口读取；目录不证明当前账号对该模型有实际调用权限。只有 `gpt-6.1-sol` 的文章封面路径有此前真实图片产物验证，其他模型暂不开放生图。
3. 查看并临时修改本次提示词副本，生成封面。只有找到 PNG、JPEG 或 WebP 文件并完整解码、取得尺寸后才报告成功。
4. 输入目标博客绝对路径，检查结构和文章 schema。工作台在目标博客写入元数据、独立 WebP 封面，以及 Markdown 派生正文或 HTML 原稿和配套资源；HTML 目标还必须具备同集合 schema、sandbox/srcdoc 展示、完整页面路由和 HTML 搜索记录。所有输出都会形成 SHA-256 清单，拒绝覆盖或不安全地更新。
5. 在工作台中打开目标博客首页和文章页真实本地预览，查看精确文件差异。
6. 发布确认页显示完整差异、文件清单、当前分支和推送目标。只有点击“提交并推送”才会提交本次文章与封面；已有暂存改动时停止。推送不会在此工具中被当作平台部署或公开页面已验证。

目录选择受浏览器 File API 限制，无法识别 symlink 元数据；需要检查符号链接时请用 ZIP 导入，ZIP 会拒绝链接。单个导入包最多 100 MiB 压缩、256 MiB 展开、2,000 个文件、单文件 50 MiB。HTML 资源使用 HTML/CSS/ES 模块解析器检查；外链保留并提示，缺失文件、本机绝对路径和无法静态解析的活动依赖会阻止准备预览。

默认封面提示词基线位于 [`prompts/article-cover/v2.md`](./prompts/article-cover/v2.md)，旧版 `v1.md` 保留。新导入任务使用 v2；任务只修改临时副本，不会覆盖版本文件，已有任务副本保持原样。

## 开发检查

```sh
npm test
npm run typecheck
npm run build
```

项目边界、架构和当前证据见 [AGENTS.md](./AGENTS.md)、[项目上下文](./docs/PROJECT_CONTEXT.md)、[首版规格](./docs/product/spec.md)和[开发记录](./docs/development-log.md)。
