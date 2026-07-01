/**
 * OG PNG 端点：覆盖每篇 post.id 以及站点默认卡片 '_site'。
 * params.slug 含 '/'，rest 路由静态写出如 /og/zh/hello-astro.png。
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { renderOgPng } from '@/lib/og';
import { SITE, SITE_META } from '@/consts';

interface OgProps {
  title: string;
  tags: string[];
  kind: 'post' | 'site';
}

export const getStaticPaths = (async () => {
  const posts = await getCollection('posts');
  const postPaths = posts.map((p) => ({
    params: { slug: p.id },
    props: {
      title: p.data.title,
      tags: p.data.tags ?? [],
      kind: 'post' as const,
    },
  }));
  const sitePath = {
    params: { slug: '_site' },
    props: {
      title: `${SITE.name} · ${SITE_META.zh.title}`,
      tags: [],
      kind: 'site' as const,
    },
  };
  return [...postPaths, sitePath];
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const { title, tags, kind } = props as OgProps;
  const png = await renderOgPng({ title, tags, kind });
  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
