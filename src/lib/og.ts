/**
 * OG 图栅格化：用手写 SVG + Resvg 生成 1200x630 PNG。
 * 失败时返回纯背景 PNG，保证构建不中断。
 */
import { Resvg } from '@resvg/resvg-js';
import { SITE, SITE_URL } from '@/consts';

export interface OgOptions {
  title: string;
  tags?: string[];
  kind?: 'post' | 'site';
}

const WIDTH = 1200;
const HEIGHT = 630;
const TITLE_FONT_FAMILY =
  "'Noto Sans CJK SC','Noto Sans','DejaVu Sans',sans-serif";
const MONO_FONT_FAMILY = "'DejaVu Sans Mono','Noto Sans Mono',monospace";

const MAX_TITLE_LINES = 4;
const MAX_LATIN_PER_LINE = 36;
const MAX_CJK_PER_LINE = 18;
const MAX_TAGS = 3;

const CJK_RE = /[　-〿぀-ヿ㐀-䶿一-鿿가-힯]/;

/** 转义 SVG 文本中的特殊字符 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 估算字符"权重"：CJK=1，拉丁=0.5，用以衡量行长 */
function charWeight(ch: string): number {
  return CJK_RE.test(ch) ? 1 : 0.5;
}

/** 简单折行：CJK 按字数、拉丁按词，按权重计算每行容量 */
export function wrapTitle(text: string, maxLines: number = MAX_TITLE_LINES): string[] {
  const limit = MAX_CJK_PER_LINE;
  const lines: string[] = [];
  let buf = '';
  let weight = 0;

  const tokens: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? '';
    if (CJK_RE.test(ch) || /\s/.test(ch) || /[，。！？；：、,.!?;:]/.test(ch)) {
      if (ch.trim() !== '' || !/\s/.test(ch)) tokens.push(ch);
      else tokens.push(' ');
      i += 1;
    } else {
      let word = '';
      while (
        i < text.length &&
        !CJK_RE.test(text[i] ?? '') &&
        !/\s/.test(text[i] ?? '') &&
        !/[，。！？；：、,.!?;:]/.test(text[i] ?? '')
      ) {
        word += text[i];
        i += 1;
      }
      tokens.push(word);
    }
  }

  for (const tok of tokens) {
    const tokWeight = [...tok].reduce((acc, c) => acc + charWeight(c), 0);
    if (weight + tokWeight > limit && buf.length > 0) {
      lines.push(buf.trimEnd());
      buf = '';
      weight = 0;
      if (lines.length >= maxLines) break;
      if (tok === ' ') continue;
    }
    buf += tok;
    weight += tokWeight;
  }
  if (buf.length > 0 && lines.length < maxLines) lines.push(buf.trimEnd());

  if (lines.length >= maxLines) {
    const overflow = tokens.join('').length > lines.join('').length;
    if (overflow) {
      const last = lines[maxLines - 1] ?? '';
      lines[maxLines - 1] = last.slice(0, Math.max(0, MAX_LATIN_PER_LINE - 1)).trimEnd() + '…';
    }
  }
  return lines.slice(0, maxLines);
}

function domainFromSiteUrl(): string {
  try {
    return new URL(SITE_URL).host;
  } catch {
    return 'localhost';
  }
}

function buildSvg(opts: OgOptions): string {
  const accent = SITE.ogAccent;
  const bg = SITE.ogBackground;
  const titleLines = wrapTitle(opts.title);
  const lineHeight = 78;
  const titleStartY = HEIGHT / 2 - ((titleLines.length - 1) * lineHeight) / 2;
  const tags = (opts.tags ?? []).slice(0, MAX_TAGS).map(escapeXml);
  const domain = escapeXml(domainFromSiteUrl());
  const siteLabel = `~/${escapeXml(SITE.name)}`;

  const titleTspans = titleLines
    .map(
      (line, idx) =>
        `<tspan x="80" y="${titleStartY + idx * lineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join('');

  const tagChips = tags
    .map((tag, idx) => {
      const chipWidth = Math.max(80, tag.length * 16 + 36);
      const x = 80 + idx * (chipWidth + 16);
      const y = HEIGHT - 90;
      return `<g>
        <rect x="${x}" y="${y}" width="${chipWidth}" height="44" rx="22" ry="22"
          fill="none" stroke="${accent}" stroke-width="2" opacity="0.85" />
        <text x="${x + chipWidth / 2}" y="${y + 29}" text-anchor="middle"
          font-family="${MONO_FONT_FAMILY}" font-size="20" fill="${accent}">#${tag}</text>
      </g>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.28" />
      <stop offset="60%" stop-color="${accent}" stop-opacity="0.05" />
      <stop offset="100%" stop-color="${bg}" stop-opacity="0" />
    </linearGradient>
    <radialGradient id="glow" cx="0.85" cy="0.15" r="0.6">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.35" />
      <stop offset="100%" stop-color="${bg}" stop-opacity="0" />
    </radialGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M 48 0 L 0 0 0 48" fill="none" stroke="${accent}" stroke-width="0.6" opacity="0.08" />
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="${bg}" />
  <rect width="100%" height="100%" fill="url(#grid)" />
  <rect width="100%" height="100%" fill="url(#bgGrad)" />
  <rect width="100%" height="100%" fill="url(#glow)" />
  <rect x="0" y="0" width="${WIDTH}" height="6" fill="${accent}" opacity="0.85" />
  <text x="80" y="100" font-family="${MONO_FONT_FAMILY}" font-size="32"
    fill="${accent}" font-weight="600">${siteLabel}</text>
  <text font-family="${TITLE_FONT_FAMILY}" font-size="64" fill="#f8fafc"
    font-weight="700" text-anchor="start">${titleTspans}</text>
  ${tagChips}
  <text x="${WIDTH - 80}" y="${HEIGHT - 60}" text-anchor="end"
    font-family="${MONO_FONT_FAMILY}" font-size="22" fill="#94a3b8">${domain}</text>
</svg>`;
}

function buildFallbackSvg(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="100%" height="100%" fill="${SITE.ogBackground}" />
  <rect x="0" y="0" width="${WIDTH}" height="6" fill="${SITE.ogAccent}" opacity="0.85" />
</svg>`;
}

function rasterize(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: WIDTH },
    font: {
      loadSystemFonts: true,
      defaultFontFamily: 'Noto Sans CJK SC',
    },
  });
  return Buffer.from(resvg.render().asPng());
}

export async function renderOgPng(opts: OgOptions): Promise<Buffer> {
  try {
    return rasterize(buildSvg(opts));
  } catch {
    try {
      return rasterize(buildFallbackSvg());
    } catch {
      return Buffer.alloc(0);
    }
  }
}
