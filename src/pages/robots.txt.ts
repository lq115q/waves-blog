import type { APIRoute } from 'astro';
import { SITE_URL } from '@/consts';

export const GET: APIRoute = () => {
  const sitemap = new URL('/sitemap-index.xml', SITE_URL).href;
  const body = `User-agent: *\nAllow: /\nSitemap: ${sitemap}\n`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
