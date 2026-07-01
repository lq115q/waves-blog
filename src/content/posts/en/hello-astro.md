---
title: "Why Astro 5 Powers This Blog"
description: "A tour of the stack behind this bilingual blog: Astro 5 Islands, zero-JS by default, Tailwind v4 CSS-first, and why I picked Astro over Next.js or a plain static generator."
pubDate: 2026-06-20
tags: ['astro', 'meta', 'frontend']
series: "meta"
---

## Why not Next.js

Next.js is the default recommendation for most React folks writing a blog. But a blog is **80% static documents** and 20% sprinkled interactivity — search box, theme toggle, command palette. At that ratio, Next's "server-rendered + hydrate everything" model drags in complexity I don't need:

- Full-page React hydration; I have to chase CLS and TTI manually
- Three mental models living together: middleware, ISR, Edge runtime
- Tailwind v4 + Turbopack still has rough edges around PostCSS and CSS layer order

What I actually want is **zero JS by default, islands on demand**. That's exactly the bet [Astro 5 Islands](https://docs.astro.build/en/concepts/islands/) makes.

## The stack at a glance

| Concern | Choice | Why |
| --- | --- | --- |
| Framework | Astro 5 | Islands, SSG, built-in i18n, Pagefind integration |
| Styling | Tailwind v4 + `@tailwindcss/vite` | CSS-first, no `tailwind.config.js` |
| Code highlight | Shiki (build-time) | Zero runtime highlight JS, dual themes |
| On-site search | Pagefind | Static index, no backend |
| Hosting | Azure Static Web Apps | Free tier + OIDC deploy, no long-lived secrets |

## Key decisions in `astro.config.mjs`

```ts title="astro.config.mjs (excerpt)"
export default defineConfig({
  site,
  trailingSlash: 'ignore',

  // Chinese-first at the root, English under /en/
  i18n: {                                       // [!code highlight]
    defaultLocale: 'zh',                        // [!code highlight]
    locales: ['zh', 'en'],                      // [!code highlight]
    routing: { prefixDefaultLocale: false },
  },

  // Shiki: dual themes + diff/highlight/focus, all at build time
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

  // Viewport prefetch for buttery view transitions
  prefetch: { prefetchAll: true, defaultStrategy: 'viewport' },
});
```

`prefixDefaultLocale: false` means **Chinese lives at the root** — `/posts/hello-astro/` rather than `/zh/posts/hello-astro/`. That keeps Chinese readers from feeling like they landed on a sub-site. English always carries the `/en/` prefix, which keeps `hreflang` and SEO clean.

### Content collections: Zod blocks bad data at build time

`src/content.config.ts` uses Zod to validate frontmatter at build time. Bad data never makes it into the site, and CI goes red instantly.

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
      summary: z.string().optional(),    // injected by the AI pipeline
    }),
});
```

> Counter-example from real life: someone once wrote `tags: "astro, meta"` as a string. The bug surfaced at runtime. Zod turns that into a hard build failure.

## DX: containers + Make

The host only needs Docker. Node and pnpm live inside an isolated container:

```bash
make image      # build the dev image
make dev        # start http://localhost:4321
make build      # production build + Pagefind index
make enrich     # run the AI pipeline (--network host to reach the local copilot-proxy)
```

No pollution of the host's Node version. Onboarding for a teammate is just `Dockerfile` + `Makefile`.

## Things I'm deliberately *not* doing

- **No SSR.** A blog is a pile of HTML; SSR only adds runtime complexity.
- **No client-rendered Markdown.** Highlighting, TOC, and indexes are all built at compile time.
- **No third-party CDNs** (fonts and JS are all `self`). That choice is what makes the [strict CSP](/en/posts/strict-csp-on-static-hosting/) actually feasible.

The next post digs into the CSP and the trade-offs I made on static hosting.
