# IverBlog 首个目标仓库参考路径

目标仓库位于当前工作区兄弟目录：`/Users/duanyifan/Environment/project/iverBlog`。本文件是路径索引，不把IverBlog源码复制到工具仓库。

开发文章流程前，在目标仓库重新核对：

- `AGENTS.md`：项目规则。
- `src/content/config.ts` 或当前实际内容schema：文章frontmatter约束。
- `src/components/ArticleCard.astro`、文章详情路由及图片处理：封面实际关联和展示。
- `.scratch/blog-evolution/article-publishing-workflow.md`：文章导入、预览、发布流程。
- `.scratch/blog-evolution/cover-generation.md` 与封面历史：文章封面提示词与版本流程。
- `.scratch/blog-evolution/background-scenes.md` 和 `.scratch/blog-evolution/background-generation.md`：未来首页背景规则，不能拿封面规则代替。
- `docs/deployment-log.md`：只作为历史部署证据；实际发布仍需核验用户配置与当前Git状态。

目标仓库的这些文件可能继续变化。运行工具时应以用户所选目标仓库的当前规则和源码为准，不依赖此索引里的路径版本或本地绝对目录。
