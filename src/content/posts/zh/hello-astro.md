---
title: "为什么用 Astro 5 搭这个博客"
description: "记录这个双语技术博客的技术选型：Astro 5 Islands、零 JS 默认、Tailwind v4 CSS-first，以及为什么不选 Next 或纯静态生成器。"
pubDate: 2026-06-20
tags: ['astro', 'meta', 'frontend']
series: "meta"
---

## 为什么不是 Next.js

写博客最常被推荐的是 Next.js，但博客 80% 的页面是**纯文档**，剩下 20% 才需要一点交互（搜索框、主题切换、命令面板）。在这种比例下，Next 的「默认服务端 + 客户端水合」模型会带来一堆我不需要的复杂度：

- 整页 React 水合，CLS、TTI 都得自己抠
- 中间件、ISR、Edge runtime 三种心智模型同时存在
- Tailwind v4 在 Turbopack 上的边角问题（PostCSS / CSS layer 顺序）

我想要的是**默认 0 JS、按需上岛**。这正好是 [Astro 5 Islands](https://docs.astro.build/en/concepts/islands/) 的核心承诺。

## 技术栈一览

| 关注点 | 选型 | 理由 |
| --- | --- | --- |
| 框架 | Astro 5 | Islands、SSG、内置 i18n、Pagefind 集成 |
| 样式 | Tailwind v4 + `@tailwindcss/vite` | CSS-first，无 `tailwind.config.js` |
| 代码高亮 | Shiki（构建期） | 0 运行时高亮 JS，双主题 |
| 站内搜索 | Pagefind | 静态索引，零后端 |
| 部署 | Azure Static Web Apps | 免费层 + OIDC 部署，无长效 secret |

## Astro 配置里几个关键决策

```ts title="astro.config.mjs (节选)"
export default defineConfig({
  site,
  trailingSlash: 'ignore',

  // 中文优先（根路径），英文 /en/
  i18n: {                                       // [!code highlight]
    defaultLocale: 'zh',                        // [!code highlight]
    locales: ['zh', 'en'],                      // [!code highlight]
    routing: { prefixDefaultLocale: false },
  },

  // Shiki：双主题 + diff/highlight/focus，全部构建期完成
  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark-default' },
      transformers: [
        transformerNotationDiff(),
        transformerNotationHighlight(),
        transformerNotationFocus(),
      ],
    },
  },

  // 视口预取下一页，与 View Transitions 协同
  prefetch: { prefetchAll: true, defaultStrategy: 'viewport' },
});
```

`prefixDefaultLocale: false` 决定了**中文走根路径**：`/posts/hello-astro/` 而不是 `/zh/posts/hello-astro/`。这是为了让中文读者不感到「我在副站点」。英文则永远带 `/en/` 前缀，方便 hreflang 和 SEO。

### 内容集合：Zod 在编译期挡坏数据

`src/content.config.ts` 用 Zod 把 frontmatter 校验前置到构建期。坏数据进不了站，CI 直接红。

```ts
const posts = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),
  schema: ({ image }) =>
    z.object({
      title: z.string().min(1).max(120),
      description: z.string().min(1).max(200),
      pubDate: z.coerce.date(),
      tags: z.array(z.string()).default([]),
      draft: z.boolean().default(false),
      cover: image().optional(),
      summary: z.string().optional(),    // AI 流水线注入
    }),
});
```

> 一个反例：之前有人把 `tags` 写成字符串 `"astro, meta"`，运行时才报错。Zod 把它改成「构建直接失败」。

## 开发体验：容器化 + Make

宿主只需 Docker，Node/pnpm 都跑在隔离容器里：

```bash
make image      # 构建开发镜像
make dev        # 启动 http://localhost:4321
make build      # 生产构建 + Pagefind 索引
make enrich     # 跑 AI 流水线（--network host 访问宿主 copilot-proxy）
```

不污染本机 Node 版本，团队成员复刻只看 `Dockerfile` 和 `Makefile`。

## 不打算做的事

- **不上 SSR**。博客就是一堆 HTML，SSR 只会引入运行时复杂度。
- **不写客户端水合的 Markdown 渲染**。所有高亮、TOC、目录都在构建期生成。
- **不依赖第三方 CDN**（字体、JS 全部 `self`）。这条直接决定了 [严格 CSP](/posts/strict-csp-on-static-hosting/) 的可行性。

下一篇会专门讲 CSP 在静态托管上的实践与坑。
