---
title: "View Transitions x Astro Islands: Buttery Navigation on a Tight Budget"
description: "Pair the native View Transitions API with Astro Islands to land smooth cross-page motion and scoped interactivity — while keeping the zero-JS default and a sub-50 KB first-paint budget."
pubDate: 2026-06-28
tags: ['astro', 'performance', 'ux']
series: "performance"
---

## Budget first, animation second

Set the performance budget up front, or the shiny demos will erode it before you notice:

| Metric | Target | Measured (home page) |
| --- | --- | --- |
| First-paint JS | < 50 KB (gzip) | 12 KB |
| LCP | < 1.5 s | 0.9 s |
| CLS | < 0.05 | 0.01 |
| INP (worst 10%) | < 200 ms | 110 ms |

Any animation that regresses one of these by more than 10% gets rolled back. Hard cap.

## View Transitions: the browser does the work

Chrome 111+ and Safari 18+ ship the [View Transitions API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API) natively. Astro 5 wraps it as `<ClientRouter />`:

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

That single element does three things:

1. Intercepts in-site link clicks and swaps in `fetch` + `document.startViewTransition`
2. Replaces `<body>` while keeping any `<head>` nodes marked `transition:persist`
3. **Falls back gracefully** to a normal navigation in unsupported browsers

No React, no framer-motion, **zero extra dependencies**.

### Directives I actually use

| Directive | Purpose | Typical use case |
| --- | --- | --- |
| `transition:name="x"` | Shared element across pages, morph | List card cover -> article hero |
| `transition:animate="slide"` | Choose the direction | Previous / next article |
| `transition:persist` | Keep a node across pages | Sticky audio player, command palette |
| `transition:persist-props` | Keep React props too | Persistent counter island |

The everyday pattern:

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

The detail page's matching `<img>` and `<h2>` morph into place automatically. Zero custom CSS.

## Islands: interactivity with a price tag

View Transitions handle motion *between* pages. Islands handle interactivity *within* a page. One rule:

> Static by default. **Every new island has to answer "how many times per month is this actually used?"**

Islands currently live on the site:

```ts title="src/components/islands.ts"
// Command palette: cmd+K / ctrl+K, reuses cmdk
export { default as CommandMenu } from './CommandMenu';   // [!code ++]

// Theme toggle: must be client:load to avoid FOUC
export { default as ThemeToggle } from './ThemeToggle';   // [!code ++]

// Comments: lazy import, only fetched when in viewport
export { default as Comments } from './Comments';         // [!code ++]

// Reading time: computed at build time, no island needed
// export { default as ReadingTime } from './ReadingTime'; // [!code --]
```

### What `client:*` actually costs

```astro
<!-- Loads immediately; enters the critical parsing path. Use sparingly. -->
<ThemeToggle client:load />

<!-- Loads when the browser is idle. The default 80% choice. -->
<CommandMenu client:idle />                     <!-- [!code focus] -->

<!-- Loads when scrolled into view. Footer newsletter form. -->
<NewsletterForm client:visible />

<!-- Loads only when the media query matches. Mobile-only nav. -->
<MobileNav client:media="(max-width: 768px)" />
```

`client:idle` is the right default for almost everything. Reserve `client:load` for things that look broken if they're not interactive immediately — the theme toggle, for instance, flashes the wrong palette without it.

## Sharp edges where the two meet

### Edge 1: third-party scripts run twice

`<ClientRouter />` re-executes `<head>` scripts that aren't `transition:persist`. Plausible, Cloudflare Insights, and friends re-initialize each navigation.

```astro
<script
  is:inline
  data-domain="example.com"
  src="/js/analytics.js"
  transition:persist                              <!-- [!code highlight] -->
></script>
```

With `transition:persist` the node survives the swap and is not re-inserted.

### Edge 2: duplicate `view-transition-name`

```css
/* All cards share the same name; the transition silently fails */
.card img { view-transition-name: cover; }       /* [!code --] */

/* Make each image unique */
.card img { view-transition-name: var(--cover-name); }  /* [!code ++] */
```

Unique names come from frontmatter slugs, set via `style={`--cover-name: cover-${slug}`}` in the template.

### Edge 3: prefetch and transitions feed each other

`astro.config.mjs` enables:

```ts
prefetch: { prefetchAll: true, defaultStrategy: 'viewport' }
```

Links in the viewport have their HTML already cached. Click -> `startViewTransition` immediately has both old and new DOM. Transitions feel nearly instant. Best free lunch on the menu.

## Measure, don't vibe

"Feels fast" doesn't ship. I run these regularly:

```bash
# Lighthouse CI, budget defined in .lighthouserc.json
npx lhci autorun --collect.url=http://localhost:4322/

# Web Vitals live (during dev)
pnpm dev
# In the browser console:
#   import('https://unpkg.com/web-vitals?module').then(v => v.onINP(console.log))
```

Any animation has to clear both before it lands. Great-feeling motion with INP over 300 ms gets cut.
