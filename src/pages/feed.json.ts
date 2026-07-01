import type { APIContext, APIRoute } from 'astro';
import { SITE, SITE_META, SITE_URL, type Locale } from '@/consts';
import { isoDate } from '@/lib/date';
import { getPosts, postUrl } from '@/lib/posts';

export async function buildJsonFeed(locale: Locale, ctx: APIContext): Promise<Response> {
  const site = ctx.site?.href ?? SITE_URL;
  const meta = SITE_META[locale];
  const posts = await getPosts(locale);
  const selfPath = locale === 'zh' ? '/feed.json' : '/en/feed.json';
  const home = new URL(locale === 'zh' ? '/' : '/en/', site).href;

  const feed = {
    version: 'https://jsonfeed.org/version/1.1',
    title: meta.title,
    description: meta.description,
    home_page_url: home,
    feed_url: new URL(selfPath, site).href,
    language: locale,
    authors: [{ name: SITE.author }],
    items: posts.map((p) => {
      const url = new URL(postUrl(p), site).href;
      return {
        id: url,
        url,
        title: p.data.title,
        content_text: p.data.description ?? '',
        date_published: isoDate(p.data.pubDate),
        date_modified: p.data.updatedDate ? isoDate(p.data.updatedDate) : isoDate(p.data.pubDate),
        tags: p.data.tags ?? [],
      };
    }),
  };

  return new Response(JSON.stringify(feed, null, 2), {
    headers: { 'Content-Type': 'application/feed+json; charset=utf-8' },
  });
}

export const GET: APIRoute = (ctx) => buildJsonFeed('zh', ctx);
