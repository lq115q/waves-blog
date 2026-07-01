---
title: "View Transitions × Astro Islands：丝滑切页与性能预算"
description: "用浏览器原生 View Transitions API 做跨页动画，配合 Astro Islands 把交互成本压在岛屿内，最终守住 0 JS 默认与首屏 < 50KB 的预算。"
pubDate: 2026-06-28
tags: ['astro', 'performance', 'ux']
series: "performance"
---

## 先定预算，再谈动画

性能预算放在最前面，免得为了酷炫滑过去之后回不来：

| 指标 | 目标 | 实测（首页） |
| --- | --- | --- |
| 首屏传输 JS | < 50 KB（gzip） | 12 KB |
| LCP | < 1.5 s | 0.9 s |
| CLS | < 0.05 | 0.01 |
| INP（最差 10%） | < 200 ms | 110 ms |

任何动画功能，如果让上面任一指标退化超过 10%，就回滚。这是硬约束。

## View Transitions：浏览器在帮我做事

Chrome 111+ / Safari 18+ 原生支持 [View Transitions API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API)。Astro 5 把它包成了 `<ClientRouter />`：

```astro title="src/layouts/Base.astro"
---
import { ClientRouter } from 'astro:transitions';
---
<html lang={lang}>
  <head>
    <ClientRouter />                            <!-- [!code highlight] -->
    <slot name="head" />
  </head>
  <body>
    <slot />
  </body>
</html>
```

这一个标签做了三件事：

1. 拦截站内链接点击，改用 `fetch` + `document.startViewTransition`
2. 替换 `<body>` 内容，保留 `<head>` 里有 `transition:persist` 的节点
3. 在不支持的浏览器上**优雅降级**为普通跳转

不需要 React、不需要 framer-motion，**0 额外依赖**。

### 我用到的指令

| 指令 | 用处 | 典型场景 |
| --- | --- | --- |
| `transition:name="x"` | 跨页面共享元素，做形变 | 文章封面 → 详情页大图 |
| `transition:animate="slide"` | 切页方向 | 上一页/下一页 |
| `transition:persist` | 节点跨页保留 | 顶部播放器、命令面板 |
| `transition:persist-props` | 保留 React props | 持久 Counter Island |

举个最常用的：

```astro
<a href={`/posts/${slug}/`}>
  <img
    src={cover}
    alt={title}
    transition:name={`cover-${slug}`}            // [!code highlight]
  />
  <h2 transition:name={`title-${slug}`}>{title}</h2>  // [!code highlight]
</a>
```

详情页上同名的 `<img>`/`<h2>` 会自动**形变到位**。零自定义 CSS。

## Islands：交互成本可量化

View Transitions 解决「页面之间」的体验，Islands 解决「页面里某一小块」的交互。原则只有一条：

> 默认全部静态，**每多一个 island，都要回答「这个交互每月用几次」**。

目前博客上线的 islands：

```ts title="src/components/islands.ts"
// 命令面板：⌘K / Ctrl+K 唤起，复用 cmdk
export { default as CommandMenu } from './CommandMenu';   // [!code ++]

// 主题切换：避开 FOUC，必须 client:load
export { default as ThemeToggle } from './ThemeToggle';   // [!code ++]

// 评论：lazy import，进入视口才下载
export { default as Comments } from './Comments';         // [!code ++]

// 阅读时长：构建期就能算出来，不需要 island
// export { default as ReadingTime } from './ReadingTime'; // [!code --]
```

### `client:*` 指令的实际开销

```astro
<!-- 立刻加载，进入解析关键路径。慎用。 -->
<ThemeToggle client:load />

<!-- 浏览器空闲再加载。命令面板、评论都用这个。 -->
<CommandMenu client:idle />                     <!-- [!code focus] -->

<!-- 进入视口才加载。页脚的订阅表单。 -->
<NewsletterForm client:visible />

<!-- 媒体查询匹配才加载。移动端专属交互。 -->
<MobileNav client:media="(max-width: 768px)" />
```

`client:idle` 是 80% 场景的最佳默认。`client:load` 只给「不加载就出现错误状态」的组件，比如主题切换（不立刻执行会闪白）。

## 与 View Transitions 协同的坑

### 坑 1：第三方脚本被反复执行

`<ClientRouter />` 默认会把 `<head>` 里没标 `transition:persist` 的脚本**重新执行一遍**。Plausible、Cloudflare Insights 这类分析脚本会重复初始化。

```astro
<script
  is:inline
  data-domain="example.com"
  src="/js/analytics.js"
  transition:persist                              <!-- [!code highlight] -->
></script>
```

加上 `transition:persist`，脚本节点跨页保留，不会被重新插入。

### 坑 2：CSS view-transition-name 重名

```css
/* 这样写，列表页所有卡片都用同一个名字，过渡会失败 */
.card img { view-transition-name: cover; }       /* [!code --] */

/* 必须每张图唯一 */
.card img { view-transition-name: var(--cover-name); }  /* [!code ++] */
```

唯一名字来自 frontmatter slug，模板里 `style={`--cover-name: cover-${slug}`}`。

### 坑 3：与 prefetch 互相增益

`astro.config.mjs` 里开了：

```ts
prefetch: { prefetchAll: true, defaultStrategy: 'viewport' }
```

视口内链接的目标 HTML 已经在缓存里。点击 → `startViewTransition` 立刻能拿到旧/新 DOM 做形变，过渡几乎瞬时。这是最值钱的免费午餐。

## 度量比手感重要

光感觉「快」不算数。我固定跑：

```bash
# Lighthouse CI，预算文件在 .lighthouserc.json
npx lhci autorun --collect.url=http://localhost:4322/

# Web Vitals 实时观测（开发期）
pnpm dev
# 浏览器控制台输入：
#   import('https://unpkg.com/web-vitals?module').then(v => v.onINP(console.log))
```

任何动画上线前都过这两步。手感好但 INP 超 300ms 的动画，直接砍掉。
