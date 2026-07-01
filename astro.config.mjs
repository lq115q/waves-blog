// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';
import pagefind from 'astro-pagefind';
import tailwindcss from '@tailwindcss/vite';
import {
  transformerNotationDiff,
  transformerNotationHighlight,
  transformerNotationFocus,
  transformerMetaHighlight,
} from '@shikijs/transformers';

// 站点规范 URL：默认真实域名，CI 可用 SITE_URL 环境变量覆盖。
const site = process.env.SITE_URL || 'https://blog.wavespro.net';

// https://astro.build/config
export default defineConfig({
  site,
  trailingSlash: 'ignore',

  // 决策 Q4=A：中文优先（根路径），英文 /en/。见 docs/02-decisions.md §B.3
  i18n: {
    defaultLocale: 'zh',
    locales: ['zh', 'en'],
    routing: { prefixDefaultLocale: false },
  },

  integrations: [mdx(), react(), sitemap(), pagefind()],

  // Shiki：双主题 + 行高亮/diff/focus，全部构建期完成（0 运行时高亮 JS）。
  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark-default' },
      defaultColor: 'light',
      wrap: false,
      transformers: [
        transformerNotationDiff(),
        transformerNotationHighlight(),
        transformerNotationFocus(),
        transformerMetaHighlight(),
      ],
    },
  },

  // Tailwind v4 走官方 Vite 插件（CSS-first，无 tailwind.config.js）。
  vite: {
    plugins: [tailwindcss()],
  },

  build: { format: 'directory' },

  // 严格 CSP：Astro 为每个内联脚本计算 sha256 并注入 per-page <meta> CSP，
  // 从而 script-src 无需 'unsafe-inline'/nonce 也能放行自身内联脚本（Islands 水合等）。
  // 见 docs/04-security.md。frame-ancestors 由响应头 X-Frame-Options 兜底（meta 不支持）。
  experimental: {
    csp: {
      directives: [
        "default-src 'none'",
        "base-uri 'self'",
        "form-action 'none'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "manifest-src 'self'",
        "worker-src 'self'",
        'upgrade-insecure-requests',
      ],
      styleDirective: {
        resources: ["'self'", "'unsafe-inline'"],
      },
      scriptDirective: {
        resources: ["'self'"],
      },
    },
  },

  // 视口预取下一页，提升切页流畅度（与 View Transitions 协同）。
  prefetch: { prefetchAll: true, defaultStrategy: 'viewport' },
});
