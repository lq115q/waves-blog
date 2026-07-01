---
title: "静态托管上的严格 CSP：踩过的坑与最终方案"
description: "在 Azure Static Web Apps 上落地 script-src 'self'，放弃 per-request nonce，权衡 Trusted Types 与 Pagefind，并把所有响应头收进 staticwebapp.config.json。"
pubDate: 2026-06-24
tags: ['security', 'csp', 'azure']
series: "security"
---

## 目标：默认拒绝一切

我希望这个博客的安全头是「白盒」状态——读者打开 DevTools 看到的策略可以一行行解释。最终落地的 `Content-Security-Policy` 长这样：

```json title="staticwebapp.config.json (节选)"
"Content-Security-Policy": "default-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self' data: https:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; media-src 'self'; upgrade-insecure-requests"
```

要点：

- `default-src 'none'` 兜底，所有资源类型都要显式开
- `script-src 'self'`，**没有** `'unsafe-inline'`、**没有** `'unsafe-eval'`、**没有** nonce
- `frame-ancestors 'none'` + `X-Frame-Options: DENY` 双保险
- `img-src` 放开 `https:`，因为引用站外图（OG 抓图等）成本太高，比起 XSS 风险，图片可控

## 为什么放弃 per-request nonce

教科书做法是每次请求生成随机 nonce，模板里 `<script nonce="...">`，CSP 里 `script-src 'nonce-...'`。但这在**纯静态托管**下行不通：

| 障碍 | 说明 |
| --- | --- |
| 没有请求生命周期 | SWA 直接发 HTML 文件，没有「为这次请求生成 nonce」的钩子 |
| Edge Function 改 HTML 代价大 | 等于每次请求都被代理改写，缓存命中率掉到 0 |
| 与 prerender 相冲突 | Astro 默认全 SSG，nonce 必须运行时注入，破坏静态特性 |

所以选了**更朴素**的策略：

```
default-src 'none' + script-src 'self'   // [!code focus]
```

只要不在 HTML 里写 inline `<script>`、不引第三方域，`'self'` 就够了。Astro 默认输出的 `<script>` 都是 `_astro/*.js`，全部走 `'self'`。

## Trusted Types 与 Pagefind 的冲突

最开始我加了：

```diff
- "Content-Security-Policy": "default-src 'none'; script-src 'self'; ..."
+ "Content-Security-Policy": "default-src 'none'; script-src 'self'; require-trusted-types-for 'script'; trusted-types default; ..."
```

结果 Pagefind 的客户端 JS 立刻挂掉。Pagefind 内部用 `innerHTML` 把搜索结果片段塞进 DOM，没有走 Trusted Types policy。

权衡了三种方案：

1. **fork Pagefind**，包一层 `trustedTypes.createPolicy('pagefind', {...})`——维护成本高
2. **关掉 Trusted Types**，回到普通 `script-src 'self'`——XSS 风险靠输入侧防
3. **只在搜索页 report-only**，其他页强制——复杂度爆炸

最终选了 2。理由：博客的输入面只有 Markdown，而 Markdown 在构建期被 Astro/MDX 处理，**不存在用户提交内容渲染回页面**的路径。XSS 攻击面收敛到「攻击者改 Markdown 源文件」，那已经是仓库被入侵的级别，CSP 防不住。

> 一个原则：安全头不是越多越好。**搞不清后果的头别加**，否则一遇到第三方库就要紧急回滚。

## 用 SWA `globalHeaders` 而非 `_headers`

Netlify 和 Cloudflare Pages 用 `_headers` 文件，SWA 用 [`staticwebapp.config.json`](https://learn.microsoft.com/en-us/azure/static-web-apps/configuration) 里的 `globalHeaders`。两者差异：

| 维度 | `_headers` | `globalHeaders` |
| --- | --- | --- |
| 作用域 | 按 glob 匹配路径 | 全站统一 |
| 覆盖单条路由 | 在文件里再写一条 | `routes[].headers` |
| 校验 | 部署后才知道 | 本地 `npx @azure/static-web-apps-cli init --verify` 可查 |

实际上我只在两类路径上单独定制 `Cache-Control`：

```jsonc
{
  "routes": [
    { "route": "/_astro/*",     "headers": { "Cache-Control": "public, max-age=31536000, immutable" } },
    { "route": "/fonts/*",      "headers": { "Cache-Control": "public, max-age=31536000, immutable" } },
    { "route": "/pagefind/*",   "headers": { "Cache-Control": "public, max-age=86400" } }
  ]
}
```

文章 HTML 走 `globalHeaders` 的 `must-revalidate`，重新发布马上生效。

## 配套的其他头

CSP 之外还配了：

```jsonc
"Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",  // [!code highlight]
"X-Content-Type-Options": "nosniff",
"X-Frame-Options": "DENY",
"Referrer-Policy": "strict-origin-when-cross-origin",
"Cross-Origin-Opener-Policy": "same-origin",
"Cross-Origin-Embedder-Policy": "require-corp",
"Cross-Origin-Resource-Policy": "same-origin"
```

COOP/COEP/CORP 三件套是为了将来给某些岛屿用 `SharedArrayBuffer`（比如本地 WASM 搜索/向量计算）留出空间，不加这三个，将来再加会触发整页跨域上下文重建。

## 验证清单

部署前我会过一遍：

- [ ] [securityheaders.com](https://securityheaders.com) 评级 ≥ A
- [ ] [Mozilla Observatory](https://observatory.mozilla.org/) 评级 ≥ A+
- [ ] DevTools 的 Issues 面板**没有任何 CSP violation**
- [ ] Pagefind 搜索能用
- [ ] 视图过渡能用（不被 COEP/CORP 截断）

CSP 是一种**自我约束**：约束我不要随便引第三方脚本，约束我不要 inline 任何东西。这种约束本身就在帮我保持博客的极简。
