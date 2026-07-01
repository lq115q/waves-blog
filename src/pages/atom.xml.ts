import type { APIContext, APIRoute } from 'astro';
import { SITE, SITE_META, SITE_URL, type Locale } from '@/consts';
import { isoDate } from '@/lib/date';
import { getPosts, postUrl } from '@/lib/posts';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function buildAtom(locale: Locale, ctx: APIContext): Promise<Response> {
  const site = ctx.site?.href ?? SITE_URL;
  const meta = SITE_META[locale];
  const posts = await getPosts(locale);
  const selfPath = locale === 'zh' ? '/atom.xml' : '/en/atom.xml';
  const selfHref = new URL(selfPath, site).href;
  const siteHref = new URL(locale === 'zh' ? '/' : '/en/', site).href;
  const updated = posts.length > 0 ? isoDate(posts[0]!.data.pubDate) : isoDate(new Date());

  const entries = posts
    .map((p) => {
      const link = new URL(postUrl(p), site).href;
      const pub = isoDate(p.data.pubDate);
      const upd = p.data.updatedDate ? isoDate(p.data.updatedDate) : pub;
      return `  <entry>
    <title>${escapeXml(p.data.title)}</title>
    <link href="${link}" />
    <id>${link}</id>
    <published>${pub}</published>
    <updated>${upd}</updated>
    <summary>${escapeXml(p.data.description ?? '')}</summary>
  </entry>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${locale}">
  <title>${escapeXml(meta.title)}</title>
  <subtitle>${escapeXml(meta.description)}</subtitle>
  <link rel="self" type="application/atom+xml" href="${selfHref}" />
  <link rel="alternate" type="text/html" href="${siteHref}" />
  <id>${siteHref}</id>
  <updated>${updated}</updated>
  <author><name>${escapeXml(SITE.author)}</name></author>
${entries}
</feed>
`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' },
  });
}

export const GET: APIRoute = (ctx) => buildAtom('zh', ctx);
