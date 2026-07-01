#!/usr/bin/env node
// scripts/enrich-with-ai.mjs
//
// AI 增强流水线（决策 Q5=A：本机 copilot-proxy）
// ──────────────────────────────────────────────────────────────────
// 设计原则：
//   1. 只在构建期/CI/手动运行，**运行时 0 调用**。
//   2. 走本机 copilot-proxy（默认 http://localhost:4399/v1），不入隐私数据
//      —— 文章本身就是公开内容，但仍不发送 frontmatter 中的 ogImage/cover 等
//      与摘要无关的字段。
//   3. **任何错误都跳过该文件**，整脚本绝不以非 0 退出。哪怕代理挂了、文件
//      格式坏了、API 返回奇怪结构，都打印一行提示后继续；写不进就不写。
//   4. 已经有 `summary:` 的文章跳过，幂等可重跑。
//   5. 零外部依赖，只用 Node 内置 + 全局 fetch（要求 Node >= 20）。
//      不引 gray-matter、不引 js-yaml —— frontmatter 解析自己写极简版，
//      避免依赖膨胀，也避免运行时增加供应链表面。
//
// 调用方式：
//   make enrich     # 在容器内跑（已配 --network host 访问宿主 copilot-proxy）
//   pnpm enrich     # 直接在本机跑
//
// 环境变量：
//   COPILOT_PROXY_URL     默认 http://localhost:4399/v1
//   COPILOT_PROXY_MODEL   默认 claude-sonnet-4-6
//   COPILOT_PROXY_API_KEY 可选 Bearer token，本机代理通常无需

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = join(__dirname, '..', 'src', 'content', 'posts');

const PROXY_URL = process.env.COPILOT_PROXY_URL || 'http://localhost:4399/v1';
const PROXY_MODEL = process.env.COPILOT_PROXY_MODEL || 'claude-sonnet-4-6';
const PROXY_KEY = process.env.COPILOT_PROXY_API_KEY || '';

// 单次请求超时：代理不可达时不要卡住整条 CI。
const REQUEST_TIMEOUT_MS = 3000;

// ─── 工具：递归收集 .md 文件 ─────────────────────────────────────
async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out; // 目录不存在直接当空
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (entry.isFile() && /\.mdx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// ─── 工具：极简 frontmatter 解析 ────────────────────────────────
// 只处理「文件开头 ---\n...\n---\n」的块，逐行 `key: value`。
// 不解析嵌套对象/多行值，因为我们只需要判定 summary 是否存在与拼回。
function splitFrontmatter(raw) {
  // CRLF 兼容
  const text = raw.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) {
    return { fm: null, body: text, fmRaw: '' };
  }
  const end = text.indexOf('\n---\n', 4);
  if (end === -1) return { fm: null, body: text, fmRaw: '' };
  const fmRaw = text.slice(4, end);
  const body = text.slice(end + 5);
  const fm = {};
  for (const line of fmRaw.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (m) fm[m[1]] = m[2];
  }
  return { fm, body, fmRaw };
}

// 在已有 frontmatter 文本里插入 `summary: "..."`。
// 不破坏原有顺序、缩进、空行；只在最后一行非空字段后追加一行。
function injectSummary(fmRaw, summary) {
  const escaped = JSON.stringify(summary); // 自带引号转义，对 YAML 也合法
  return `${fmRaw.replace(/\s+$/, '')}\nsummary: ${escaped}\n`;
}

// ─── 工具：调用 OpenAI 兼容接口生成摘要 ────────────────────────
async function generateSummary(body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers = { 'content-type': 'application/json' };
    if (PROXY_KEY) headers.authorization = `Bearer ${PROXY_KEY}`;
    const res = await fetch(`${PROXY_URL}/chat/completions`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: PROXY_MODEL,
        temperature: 0.2,
        max_tokens: 200,
        messages: [
          {
            role: 'system',
            content:
              '你是技术博客编辑。给一段 Markdown 正文，输出一句 ≤80 字的中文/英文摘要（与正文同语言）。' +
              '只输出摘要本身，不要加引号、前缀、解释。',
          },
          // 截前 6000 字符足够摘要，且避免长流被上游断
          { role: 'user', content: body.slice(0, 6000) },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') return null;
    // 去首尾空白与引号；硬截到 80 字符防越界
    const cleaned = text.trim().replace(/^["'`]+|["'`]+$/g, '');
    return cleaned.length > 80 ? cleaned.slice(0, 80) : cleaned;
  } catch {
    return null; // 任何错误（abort/网络/解析）都吞掉
  } finally {
    clearTimeout(timer);
  }
}

// ─── 工具：探活，避免逐文件都试一次再失败 ──────────────────────
async function isProxyReachable() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // 任意 GET 即可，只看 TCP 是否能连
    const res = await fetch(PROXY_URL, { signal: controller.signal });
    // 状态码无所谓，只要有响应就算「到达」
    return Boolean(res);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ─── 主流程 ──────────────────────────────────────────────────────
async function main() {
  let exists = true;
  try {
    await stat(POSTS_DIR);
  } catch {
    exists = false;
  }
  if (!exists) {
    console.log(`[enrich] no posts dir at ${POSTS_DIR}, skip.`);
    return;
  }

  const files = await walk(POSTS_DIR);
  if (files.length === 0) {
    console.log('[enrich] no markdown files, skip.');
    return;
  }

  // 先筛出真正需要补 summary 的文件，避免没必要的代理探活
  const todo = [];
  for (const file of files) {
    try {
      const raw = await readFile(file, 'utf8');
      const { fm, body, fmRaw } = splitFrontmatter(raw);
      if (!fm) continue;
      if (typeof fm.summary === 'string' && fm.summary.trim().length > 0) continue;
      todo.push({ file, raw, body, fmRaw });
    } catch {
      // 单文件读失败：跳过，不影响其他文件
    }
  }

  if (todo.length === 0) {
    console.log('[enrich] all posts already have summary, nothing to do.');
    return;
  }

  const reachable = await isProxyReachable();
  if (!reachable) {
    console.log(
      `[enrich] copilot-proxy not reachable at ${PROXY_URL}; ` +
        `${todo.length} post(s) left without summary. Skipping gracefully.`,
    );
    return; // 优雅退出 0
  }

  let updated = 0;
  for (const { file, raw, body, fmRaw } of todo) {
    const summary = await generateSummary(body);
    if (!summary) {
      console.log(`[enrich] skip (no summary returned): ${relative(POSTS_DIR, file)}`);
      continue;
    }
    const newFm = injectSummary(fmRaw, summary);
    const next = `---\n${newFm}---\n${body.startsWith('\n') ? '' : '\n'}${body}`;
    try {
      // 拼回时尽量贴合原始排版：原文 body 前可能本就有空行
      const finalText = raw.startsWith('---\n')
        ? `---\n${newFm}---\n${body.replace(/^\n+/, '\n')}`
        : next;
      await writeFile(file, finalText, 'utf8');
      updated += 1;
      console.log(`[enrich] +summary: ${relative(POSTS_DIR, file)}`);
    } catch {
      console.log(`[enrich] write failed, skip: ${relative(POSTS_DIR, file)}`);
    }
  }

  console.log(`[enrich] done. updated=${updated}, total_candidates=${todo.length}`);
}

// 顶层 try/catch 是最后一道防线：任何漏网之鱼都被吞掉，绝不让 CI 因为
// 增强脚本失败而红。要让 CI 因构建坏数据失败，那是 astro check 的责任。
try {
  await main();
} catch (err) {
  console.log(`[enrich] unexpected error swallowed: ${err?.message || err}`);
}
process.exit(0);
