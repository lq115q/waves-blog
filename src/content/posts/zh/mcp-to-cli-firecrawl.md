---
title: "把 Firecrawl 从 MCP 换成 CLI：每会话省下 21.4k token"
description: "一个 MCP 的工具 schema 常驻吃掉每会话 ~21.4k token。换成官方 CLI + 一个按需 skill 后能力零缺口、常驻降到近零；再派 6 个并行 agent 实测 10 个场景，发现 context 占用才是 agent 选工具的第一维。"
pubDate: 2026-07-05
tags: ['claude-code', 'mcp', 'cli', 'context-engineering', 'agents']
series: "agent-harness"
---

## 一个隐形的常驻税

我给 Claude Code 装了不少 MCP。某天数了下 context，发现 **Firecrawl 一个 MCP 就吃掉每会话 ~21.4k token**——还没开始干活，光是它 ~30 个工具的 JSON schema 就先把上下文占了一大块。而我日常真正用到的，不过是 `search` 和 `scrape` 两个。

这就是 MCP 的隐形税：**工具 schema 在会话开始时全量注入，无论你这次用不用。** 30 个工具、每个都带一大坨嵌套参数（`scrapeOptions` 那种），于是 21.4k token 每次都在，跨会话累加。

Firecrawl 官方后来出了个 CLI，而且明确做成「AI agent skill」形态。我花了半天把 MCP 换成 CLI，顺带做了一场实测复盘。结论先放这儿：**值得，而且 context 从 ~21.4k 降到几乎为零。**

## 成本付在哪一刻

MCP 和 CLI 不是「谁更强」，而是**成本付在哪一刻**：

| 维度 | MCP | CLI + skill |
| --- | --- | --- |
| context | 会话开始全量注入 schema（**常驻**） | skill 闲置 ~30 token；命中才加载正文 |
| 单次调用 | schema 已在 | 模型早会 bash，~200 token/命令 |
| 结果去向 | **直接塞进 context**（整页 dump） | 写文件，`grep`/`head` 按需读 |
| 可靠性 | 持久连接，长响应易 TCP 超时 | 本地进程 per 命令，无长连可掉 |

第三方基准（Scalekit，Claude Sonnet 4，GitHub 任务）把差距量化得很直白：

- CLI：100% 可靠，1.3–8.7k token/任务
- MCP：72% 可靠，32–82k token/任务
- 10k 次操作/月：CLI ~$3.2 vs MCP ~$55.2

> 一个心智模型：**MCP 把成本一次付在会话开头，CLI 按需分摊。** 工具越多、schema 越胖、你实际用得越少，MCP 这笔预付就越亏。

对单人本地机来说更是如此——MCP 的结构性优势（多用户 OAuth、审计、持久有状态会话）我一个都用不上。

## CLI 能力够不够？

换之前最担心的是「CLI 会不会缺功能」。实测本机 CLI（v1.19.24），**30 个 MCP 工具逐一有对应，零缺口**——连我以为会缺的两个都在：

| MCP 工具 | CLI |
| --- | --- |
| `firecrawl_scrape` / `search` / `map` / `crawl` | `scrape` / `search` / `map` / `crawl` |
| `firecrawl_extract` | `scrape --schema` / `agent --schema` |
| `firecrawl_parse`（本地 PDF/DOCX） | `parse <file>`（本机实测存在） |
| `firecrawl_monitor_*`（8 个） | `monitor create/list/run/...` |
| `firecrawl_research_*`（arXiv/GitHub） | `research`（本机实测存在） |
| `firecrawl_agent` / `interact` | `agent` / `interact` |

关键差异不在能不能，而在**结果去哪**。CLI 默认把结果写到 `.firecrawl/`：

```bash
firecrawl scrape "https://example.com/pricing" --only-main-content -o .firecrawl/p.md
wc -l .firecrawl/p.md && grep -n "enterprise" .firecrawl/p.md   # [!code focus]
```

整页落盘，我只 `grep` 出想要的那几行进 context。MCP 做不到这件事——它返回什么，什么就进上下文。

## 落地的几个坑

真正动手时，有几处不写下来会翻车：

**认证不进配置。** `firecrawl login --api-key` 把 key 存进 CLI 自己的凭据库，`.mcp.json` 里那行 `FIRECRAWL_API_KEY` 反而删掉了——迁移顺手减少了一处明文密钥暴露。

**升级存活。** 我的 ECC 插件配置会在升级时被覆盖，本来有个 `apply-fixes.sh` 幂等脚本负责重打补丁。它原来的逻辑是「注入 firecrawl MCP」，现在要**反转**成「确保 firecrawl 被移除」：

```diff lang="bash"
- jq '.mcpServers.firecrawl = {command:"npx", args:["-y","firecrawl-mcp"], ...}'
+ jq 'del(.mcpServers.firecrawl)'          // [!code ++]
```

否则下次插件升级，21.4k 又自己长回来。

**连带引用。** 有个 `deep-research` skill 之前引用了 `mcp__..._firecrawl__firecrawl_search` 这类工具名，MCP 一删这些引用就悬空。得同步改成 CLI 调用，并且把这个改动也塞进 `apply-fixes.sh`，让它扛得住升级。

**别忘了 gitignore。** 多 URL scrape 会在 cwd 落一个 `.firecrawl/`，加进 `.gitignore`。

改完 `verify.sh` 跑一遍，14/14 通过：MCP 已下线、CLI 已认证、skill 存在、旧引用清零。

## 换完不能只信「应该更好」

省了 token 是一回事，CLI 抓出来的**质量**跟 MCP 比如何？我不想拍脑袋，于是派了 **6 个并行 subagent**，跨 10 个场景 + 4 个社交平台做实证横评：同一个 query 喂给所有候选工具（tavily / exa / firecrawl CLI / context7 / WebFetch / github），按统一 rubric 打分——相关性、覆盖、时延、credits，外加一维 **context 占用**。

头条发现就是那一维：

| 工具 | 单次搜索进 context 的量 |
| --- | --- |
| tavily / exa | ~6–20 KB **直接进主上下文** |
| WebFetch | ~5–15 KB（还是 LLM 摘要，非原文） |
| **firecrawl CLI** | **落盘，主上下文 ≈0**（jq/head 局部读） |

一轮多引擎评测下来，MCP 侧累计几十到上百 KB，firecrawl 侧约 3 KB。**长会话/密集搜索时，这就是数量级差距**——正是迁移的价值实证。

分场景的赢家也清晰（都是真实调用打出来的）：

| 场景 | 赢家 | 关键实测 |
| --- | --- | --- |
| 权威/事实核查 | **exa** | 命中学术 PDF / 官方文档；tavily 偏 blog 在税法上给了误导性首条 |
| 时效新闻 | **firecrawl** | `--tbs qdr:w` 硬过滤，16/16 命中且标日期 |
| SPA/JS 页抓取 | **firecrawl** | `--wait-for` 拿全 46 个代码块；tavily 抓 SPA 多行代码几乎全丢 |
| 库/框架文档 | **context7** | 版本锁定 + 官方仓库，0 credits |
| 学术论文 | **firecrawl research** | arXiv 专用，直出 `arxiv:ID + abstract` |
| 综合研究 | **tavily_research** | 一次出带 26 条引用的报告 |
| 整站 map | **firecrawl map** | 1298 URLs vs tavily 10 —— **130×** |

## 别让 subagent 的误判进库

6 个 agent 用的是 sonnet（跑执行层够用），但我用 opus 主会话抽查了两个「看起来对、其实不对」的结论——这一步救回了知识库的准确性：

- 一个 agent 报「tavily `time_range:week` 失效」。我复测发现：**time_range 是有效的**，真正的限制是这个 tavily MCP 的 `topic` 参数被 schema 锁死为 `general`、根本不接受 `topic:"news"`（实测直接报 `literal_error`）。两回事。
- 另一个 agent 报「firecrawl agent 服务侧挂了」。我复测拿到的错误是 `Error: Agent reached max credits`——不是坏了，是我们给的 `--max-credits` 上限太低被掐断。

> 并行 agent 会犯**系统性**错误：它把观察到的现象归错了因。产出可以让 agent 并行跑，但**结论落库前必须自己抽查**。

## 最后：这些要写进 CLAUDE.md 吗？

做完这一切，很自然会想：把这套搜索路由写进全局 `CLAUDE.md` 吧？

我的答案是**不要**。全局 `CLAUDE.md` 每会话都加载——往里加一张路由表，就是又制造一笔刚刚才省掉的常驻税。路由已经有两个「按需」的家：搜索/抓取任务会自动触发的 `firecrawl-cli` skill，和一份可随时 `Read` 的路由决策文档。**恰好在需要时才加载，比常驻划算。**

我只在全局索引里改了一行——把过时的「firecrawl plugin」更正成「firecrawl CLI」，加一个指针，仍是一行、零表格。

> 一个原则：**常驻上下文里的每一行都是税。** 能外链的就外链，能按需加载的就别常驻。全局文件当一页纸索引，深度内容一律推到 skill / 知识库。

## 结论

这半天下来沉淀的几条，拿去套别的重型 MCP 也成立：

- **context 占用是 agent 选工具的第一维**，不是附带指标。落盘 + 局部读 > 整页塞进上下文。
- **schema 胖、工具多、你只用其中几个的 MCP**，优先评估换 CLI + skill。先核实能力平价（真有缺口才留 MCP 按需启）。
- **改配置要考虑升级存活**：幂等脚本 + 一键校验。
- **并行 agent 提产出，主会话做裁判**：结论入库前抽查。
- **全局 `CLAUDE.md` 只做索引**，把路由/清单推到按需加载的 skill 和知识库。

省下的不只是钱，是每一次会话的推理空间。
