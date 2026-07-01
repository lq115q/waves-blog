import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * 文章集合。文件按语言分目录存放：
 *   src/content/posts/zh/**.{md,mdx}
 *   src/content/posts/en/**.{md,mdx}
 * glob loader 生成的 id 形如 `zh/hello-world`，语言可由 id 前缀推断
 * （见 src/lib/posts.ts 的 splitLangSlug）。
 *
 * frontmatter 在构建期被 Zod 校验，坏数据进不了站。
 */
const posts = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),
  schema: ({ image }) =>
    z.object({
      title: z.string().min(1).max(120),
      description: z.string().min(1).max(200),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      tags: z.array(z.string()).default([]),
      series: z.string().optional(),
      draft: z.boolean().default(false),
      /** 封面图（可选），走 astro:assets 优化 */
      cover: image().optional(),
      /** 覆盖默认 OG 图（绝对/相对 URL，可选） */
      ogImageOverride: z.string().optional(),
      /** AI 流水线生成（构建期注入），运行时只读 */
      summary: z.string().optional(),
      embedding: z.array(z.number()).optional(),
    }),
});

export const collections = { posts };
