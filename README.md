# Waves' Blog

一个基于 **Astro 5** 的「快、干净、安全」个人技术博客：默认 **0 JavaScript**、双语（中 / 英）、纯静态托管。

在线站点：<https://blog.wavespro.net>

## 特性

- **Astro 5 Islands**：默认 0 JS，只有需要交互的组件才上岛水合
- **双语 zh / en**：中文走根路径，英文走 `/en/` 前缀
- **Tailwind CSS v4**：CSS-first，无 `tailwind.config.js`
- **Shiki 代码高亮**：构建期完成，0 运行时高亮 JS，支持复制 / 行高亮 / diff
- **Pagefind 全文搜索** + **⌘K 命令面板**：纯静态索引，命令面板是站内唯一的 React island
- **View Transitions** 切页动效
- **Satori 动态 OG 图**：每篇文章构建期生成社交预览图
- **RSS / Atom / JSON Feed** 三格式并存
- **严格 CSP + 安全响应头**：每页内联脚本按 sha256 放行，无需 `unsafe-inline`
- **可选 AI 流水线**：本地生成文章摘要（构建期 / 手动，运行时 0 调用）

## 技术栈

| 关注点 | 选型 |
| --- | --- |
| 框架 | Astro 5（静态构建，Islands） |
| 样式 | Tailwind CSS v4（`@tailwindcss/vite`） |
| 语言 | TypeScript（strict） |
| 内容 | Markdown / MDX + Content Collections（Zod 校验） |
| 代码高亮 | Shiki（构建期，双主题） |
| 站内搜索 | Pagefind（静态索引） |
| 部署 | Azure Static Web Apps + GitHub Actions |

## 快速开始

### 方式一：Docker（推荐，环境隔离）

本机只需 **Docker**，Node / pnpm 都跑在容器里（固定 Node 22 LTS + pnpm）。

```bash
make install    # 安装依赖（容器内，生成 pnpm-lock.yaml）
make dev        # 开发服务器 http://localhost:4321
make build      # 生产构建 + Pagefind 索引（产物在 ./dist）
make preview    # 本地预览构建产物 http://localhost:4322
make check      # 类型检查
make shell      # 进入容器 shell
```

### 方式二：裸跑（本机已有 Node ≥ 22 + pnpm）

```bash
pnpm install
pnpm dev        # http://localhost:4321
pnpm build      # 生产构建
pnpm preview    # 预览产物
```

## 项目结构

```
src/
├── components/    # Astro / React 组件（Header、Footer、Hero、命令面板…）
├── content/       # 文章内容 posts/{zh,en}/*.md
├── i18n/          # UI 文案字典（ui.ts）与工具
├── layouts/       # 页面骨架
├── lib/           # 文章查询、日期、OG 图生成等工具
├── pages/         # 路由（中文根路径 + 英文 /en/）
├── styles/        # 全局样式
└── consts.ts      # 站点级常量（标题、作者、域名等，单一真源）
```

## 写文章

在 `src/content/posts/zh/`（或 `en/`）下新建 `.md`，顶部 frontmatter：

```yaml
---
title: "文章标题"
description: "一句话摘要（用于 SEO / OG 图）"
pubDate: 2026-07-01
tags: ['astro', 'security']
---
```

正文用标准 Markdown。代码块支持 Shiki 行高亮 / diff / focus 标注。

## 站点信息在哪改

- **站点标题 / 作者 / 域名**：`src/consts.ts`
- **界面文案（导航、按钮、页脚）**：`src/i18n/ui.ts`（中英各一份）
- **首页大标题（Hero）**：`src/components/sections/Home.astro`
- **关于页正文**：`src/components/sections/About.astro`

## 部署

构建产物是纯静态 `dist/`，托管在 **Azure Static Web Apps**。推送到 `main` 分支由 GitHub Actions 自动构建并部署（OIDC 认证，无长效 secret）。

## 许可

源代码 MIT（见 [`LICENSE`](./LICENSE)）。文章内容版权归作者所有。
