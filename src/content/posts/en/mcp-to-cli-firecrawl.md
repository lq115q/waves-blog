---
title: "From MCP to CLI: Cutting 21.4k Tokens of Context per Session"
description: "Firecrawl's MCP cost ~21.4k tokens per session. Its official CLI + an on-demand skill cut that to near zero with no capability lost. Plus a 6-agent bake-off on agent tool choice."
pubDate: 2026-07-05
tags: ['claude-code', 'mcp', 'cli', 'context-engineering', 'agents']
series: "agent-harness"
---

## An invisible resident tax

I run a fair number of MCP servers in Claude Code. One day I counted my context budget and found **Firecrawl alone was eating ~21.4k tokens every session** — before I'd done any work, the JSON schemas for its ~30 tools had already claimed a big slice of the window. In daily use I touch exactly two of them: `search` and `scrape`.

That's the hidden tax of MCP: **tool schemas are injected in full at the start of every session, whether you use them or not.** Thirty tools, each with a fat nested parameter blob (the `scrapeOptions` kind), so those 21.4k tokens are always there, compounding across sessions.

Firecrawl later shipped a CLI — and deliberately packaged it as an "AI agent skill." I spent half a day swapping the MCP for it and ran a proper post-mortem. The verdict up front: **worth it, and resident context dropped from ~21.4k to essentially nothing.**

## Where the cost is paid

MCP vs CLI isn't "which is stronger" — it's **when you pay the cost**:

| Dimension | MCP | CLI + skill |
| --- | --- | --- |
| context | full schema injected at session start (**resident**) | skill idle ~30 tokens; body loads only on a match |
| per call | schema already loaded | the model already knows bash, ~200 tokens/command |
| where results go | **straight into context** (whole page dumped) | written to a file, read on demand with `grep`/`head` |
| reliability | persistent connection; long responses hit TCP timeouts | local process per command, no long-lived connection to drop |

A third-party benchmark (Scalekit, Claude Sonnet 4, GitHub tasks) makes the gap concrete:

- CLI: 100% reliable, 1.3–8.7k tokens/task
- MCP: 72% reliable, 32–82k tokens/task
- 10k operations/month: CLI ~$3.2 vs MCP ~$55.2

> A mental model: **MCP pays the cost once, upfront; the CLI amortizes it on demand.** The more tools, the fatter the schemas, and the fewer you actually use, the worse that MCP prepayment looks.

On a single-user local machine it's even more lopsided — MCP's structural wins (per-user OAuth, audit trails, stateful sessions) are things I never touch.

## Does the CLI cover everything?

My biggest worry before switching was "what if the CLI is missing features." Tested on the local CLI (v1.19.24): **all 30 MCP tools map to a CLI command, zero gaps** — including the two I expected to be missing:

| MCP tool | CLI |
| --- | --- |
| `firecrawl_scrape` / `search` / `map` / `crawl` | `scrape` / `search` / `map` / `crawl` |
| `firecrawl_extract` | `scrape --schema` / `agent --schema` |
| `firecrawl_parse` (local PDF/DOCX) | `parse <file>` (verified present) |
| `firecrawl_monitor_*` (8) | `monitor create/list/run/...` |
| `firecrawl_research_*` (arXiv/GitHub) | `research` (verified present) |
| `firecrawl_agent` / `interact` | `agent` / `interact` |

The real difference isn't *whether* — it's *where the result lands*. The CLI writes to `.firecrawl/` by default:

```bash
firecrawl scrape "https://example.com/pricing" --only-main-content -o .firecrawl/p.md
wc -l .firecrawl/p.md && grep -n "enterprise" .firecrawl/p.md   # [!code focus]
```

The whole page hits disk; I `grep` only the lines I want into context. An MCP tool can't do that — whatever it returns *is* what enters the conversation.

## The migration gotchas

A few things will bite you if you don't write them down:

**Auth doesn't live in the config.** `firecrawl login --api-key` stores the key in the CLI's own credential store, and I *deleted* the `FIRECRAWL_API_KEY` line from `.mcp.json`. The migration actually removed one plaintext-secret exposure.

**Surviving upgrades.** My ECC plugin config gets overwritten on upgrade, so an idempotent `apply-fixes.sh` re-applies my patches. Its logic used to be "inject the Firecrawl MCP" — now it has to **invert** to "ensure Firecrawl is removed":

```diff lang="bash"
- jq '.mcpServers.firecrawl = {command:"npx", args:["-y","firecrawl-mcp"], ...}'
+ jq 'del(.mcpServers.firecrawl)'          // [!code ++]
```

Otherwise the next plugin upgrade grows those 21.4k tokens right back.

**Dangling references.** A `deep-research` skill referenced tool names like `mcp__..._firecrawl__firecrawl_search`. Once the MCP is gone, those references point at nothing. They have to be rewritten to CLI calls — and that rewrite folded into `apply-fixes.sh` too, so it survives upgrades.

**Don't forget gitignore.** Multi-URL scrapes drop a `.firecrawl/` in the cwd; add it to `.gitignore`.

A `verify.sh` run afterward went 14/14: MCP gone, CLI authenticated, skill present, old references at zero.

## Don't just trust "should be better"

Saving tokens is one thing — but how does CLI-scraped **quality** compare to the MCP? I didn't want to guess, so I dispatched **6 parallel subagents** to run an empirical bake-off across 10 scenarios plus 4 social platforms: the same query fed to every candidate (tavily / exa / firecrawl CLI / context7 / WebFetch / github), scored on one rubric — relevance, coverage, latency, credits, and one extra axis: **context footprint**.

That axis was the headline:

| Tool | Bytes into context per search |
| --- | --- |
| tavily / exa | ~6–20 KB **straight into the main context** |
| WebFetch | ~5–15 KB (and it's an LLM summary, not the source) |
| **firecrawl CLI** | **written to disk, main context ≈0** (read locally via jq/head) |

Across one multi-engine sweep, the MCP side accumulated tens to hundreds of KB; the firecrawl side about 3 KB. **In a long or search-heavy session that's an order-of-magnitude gap** — the empirical case for the migration.

The per-scenario winners were clear too (all from real calls):

| Scenario | Winner | Key result |
| --- | --- | --- |
| Authority / fact-check | **exa** | hit academic PDFs / official docs; tavily leaned on a blog and led with a misleading tax claim |
| Fresh news | **firecrawl** | `--tbs qdr:w` hard-filters, 16/16 within window and dated |
| SPA/JS pages | **firecrawl** | `--wait-for` captured all 46 code blocks; tavily lost nearly all multi-line code on SPAs |
| Library/API docs | **context7** | version-locked + official repo, 0 credits |
| Academic papers | **firecrawl research** | arXiv-native, emits `arxiv:ID + abstract` |
| Synthesis research | **tavily_research** | one call → a report with 26 citations |
| Whole-site map | **firecrawl map** | 1298 URLs vs tavily's 10 — **130×** |

## Don't let a subagent's misread reach the docs

The 6 agents ran on Sonnet (fine for the execution layer), but I used the Opus main session to spot-check two conclusions that *looked* right and weren't — and that step saved the knowledge base's accuracy:

- One agent reported "tavily `time_range:week` doesn't work." Re-testing: **time_range is fine.** The real limit is that this tavily MCP's `topic` parameter is schema-locked to `general` and rejects `topic:"news"` outright (a literal `literal_error`). Two different things.
- Another reported "firecrawl agent is server-side broken." The actual error was `Error: Agent reached max credits` — not broken, just a `--max-credits` cap set too low.

> Parallel agents make **systematic** errors: they attribute a real symptom to the wrong cause. Fan out the *work* to agents, but **verify the conclusions yourself before they land in the docs.**

## Should any of this go in CLAUDE.md?

After all that, the natural next thought: put this search-routing table into the global `CLAUDE.md`?

My answer is **no**. The global `CLAUDE.md` loads every session — adding a routing table would recreate exactly the resident tax I'd just removed. The routing already has two on-demand homes: the `firecrawl-cli` skill that auto-triggers on search/scrape tasks, and a routing-decision doc I can `Read` anytime. **Loading it precisely when needed beats keeping it resident.**

I changed a single line in the global index — corrected a stale "firecrawl plugin" to "firecrawl CLI" and added a pointer. Still one line, no table.

> A principle: **every line of resident context is a tax.** Link out what can be linked; defer to on-demand loading what can be deferred. Keep the global file a one-page index; push depth into skills and knowledge bases.

## Takeaways

A few things from the afternoon that generalize to any heavy MCP:

- **Context footprint is the first axis of agent tool choice**, not a footnote. Write-to-disk-and-read-locally beats dumping whole pages into context.
- **For an MCP with fat schemas, many tools, and only a few you actually use**, evaluate moving to CLI + skill. Verify capability parity first (keep the MCP only if there's a real gap).
- **Design config changes to survive upgrades**: idempotent script + one-command verification.
- **Agents for throughput, main session as judge**: spot-check before conclusions land.
- **Keep the global `CLAUDE.md` an index**; push routing/inventories into on-demand skills and knowledge bases.

What you save isn't just money — it's reasoning room in every single session.
