import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { SITE_META, SITE_URL } from '@/consts';
import { getPosts, postUrl } from '@/lib/posts';

export const GET = async (ctx: APIContext) => {
  const posts = await getPosts('en');
  const site = ctx.site?.href ?? SITE_URL;
  return rss({
    title: SITE_META.en.title,
    description: SITE_META.en.description,
    site,
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.description,
      pubDate: p.data.pubDate,
      link: new URL(postUrl(p), site).href,
      categories: p.data.tags,
    })),
  });
};
