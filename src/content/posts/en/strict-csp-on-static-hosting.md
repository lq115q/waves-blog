---
title: "Strict CSP on Static Hosting: Lessons from Azure SWA"
description: "Shipping script-src 'self' on Azure Static Web Apps: why per-request nonces are off the table, the Trusted Types / Pagefind trade-off, and pinning every header in staticwebapp.config.json."
pubDate: 2026-06-24
tags: ['security', 'csp', 'azure']
series: "security"
---

## Goal: deny by default

I want the security posture of this blog to be **glass-box**: any reader can open DevTools and I can explain every directive line by line. Here's what shipped:

```json title="staticwebapp.config.json (excerpt)"
"Content-Security-Policy": "default-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self' data: https:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; media-src 'self'; upgrade-insecure-requests"
```

Key points:

- `default-src 'none'` as the floor — every resource type is opted in explicitly
- `script-src 'self'`, with **no** `'unsafe-inline'`, **no** `'unsafe-eval'`, **no** nonce
- `frame-ancestors 'none'` + `X-Frame-Options: DENY` belt-and-suspenders
- `img-src` allows `https:` because referencing off-site images (OG snapshots, etc.) is too costly to lock down, and image-based XSS is a far smaller surface than script

## Why per-request nonces are off the table

The textbook recipe is: generate a random nonce per request, stamp it on `<script nonce="...">`, and add `'nonce-...'` to `script-src`. On **pure static hosting** that falls apart:

| Obstacle | Detail |
| --- | --- |
| No request lifecycle | SWA serves HTML files directly; there's no hook to mint a nonce per request |
| Rewriting at the edge is expensive | Every request would proxy through a function, dropping cache hit rate to zero |
| Conflicts with prerendering | Astro is fully SSG; injecting nonces at runtime breaks the static contract |

So I picked a **plainer** policy:

```
default-src 'none' + script-src 'self'   // [!code focus]
```

As long as I don't write inline `<script>` and don't pull in third-party domains, `'self'` is enough. Astro emits `<script>` tags that point at `_astro/*.js` — all served from the same origin.

## Trusted Types vs Pagefind

My first attempt added Trusted Types:

```diff
- "Content-Security-Policy": "default-src 'none'; script-src 'self'; ..."
+ "Content-Security-Policy": "default-src 'none'; script-src 'self'; require-trusted-types-for 'script'; trusted-types default; ..."
```

Pagefind broke immediately. The search client uses `innerHTML` to slot result snippets into the DOM without going through a Trusted Types policy.

Three options were on the table:

1. **Fork Pagefind** and wrap a `trustedTypes.createPolicy('pagefind', {...})` around it — high maintenance burden
2. **Drop Trusted Types**, fall back to a plain `script-src 'self'`, and lean on input-side defenses against XSS
3. **Report-only on the search page**, enforced everywhere else — complexity explodes

I went with option 2. Rationale: the blog's *input* surface is just Markdown, and Markdown is processed by Astro/MDX at build time. **There is no path where user-submitted content is rendered back into the page.** The XSS attack surface collapses to "attacker rewrites a Markdown file," which is repo-compromise tier — CSP can't help at that point.

> Rule of thumb: more security headers is not always better. **Don't ship a header whose blast radius you can't explain**, or you'll be doing emergency rollbacks the next time a third-party library lands.

## `globalHeaders` instead of `_headers`

Netlify and Cloudflare Pages use a `_headers` file. SWA uses `globalHeaders` inside [`staticwebapp.config.json`](https://learn.microsoft.com/en-us/azure/static-web-apps/configuration). The differences:

| Dimension | `_headers` | `globalHeaders` |
| --- | --- | --- |
| Scope | glob-matched paths | site-wide |
| Per-route override | another line in the same file | `routes[].headers` |
| Validation | only after deploy | local `npx @azure/static-web-apps-cli init --verify` |

In practice I only customize `Cache-Control` on two path classes:

```jsonc
{
  "routes": [
    { "route": "/_astro/*",     "headers": { "Cache-Control": "public, max-age=31536000, immutable" } },
    { "route": "/fonts/*",      "headers": { "Cache-Control": "public, max-age=31536000, immutable" } },
    { "route": "/pagefind/*",   "headers": { "Cache-Control": "public, max-age=86400" } }
  ]
}
```

Article HTML inherits `globalHeaders`' `must-revalidate`, so republishing takes effect on the next request.

## The other headers

Beyond CSP I ship:

```jsonc
"Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",  // [!code highlight]
"X-Content-Type-Options": "nosniff",
"X-Frame-Options": "DENY",
"Referrer-Policy": "strict-origin-when-cross-origin",
"Cross-Origin-Opener-Policy": "same-origin",
"Cross-Origin-Embedder-Policy": "require-corp",
"Cross-Origin-Resource-Policy": "same-origin"
```

The COOP/COEP/CORP trio is forward-looking: it lets a future island use `SharedArrayBuffer` (think local WASM search or vector math) without forcing a cross-origin context rebuild later.

## Pre-deploy checklist

- [ ] [securityheaders.com](https://securityheaders.com) score >= A
- [ ] [Mozilla Observatory](https://observatory.mozilla.org/) >= A+
- [ ] DevTools Issues panel shows **zero CSP violations**
- [ ] Pagefind search works end to end
- [ ] View transitions still work (not severed by COEP/CORP)

A strict CSP is really a form of **self-discipline**: it forbids me from sprinkling in third-party scripts or inline anything. That discipline is also what keeps the blog minimal.
