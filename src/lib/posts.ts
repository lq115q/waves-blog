import { getCollection, type CollectionEntry } from 'astro:content';
import { DEFAULT_LOCALE, type Locale } from '@/consts';
import { localizePath } from '@/i18n/utils';

export type Post = CollectionEntry<'posts'>;

/** glob id 形如 `zh/hello-world` → { lang:'zh', slug:'hello-world' } */
export function splitLangSlug(id: string): { lang: Locale; slug: string } {
  const [maybeLang, ...rest] = id.split('/');
  if (maybeLang === 'zh' || maybeLang === 'en') {
    return { lang: maybeLang, slug: rest.join('/') };
  }
  return { lang: DEFAULT_LOCALE, slug: id };
}

export const postLang = (post: Post): Locale => splitLangSlug(post.id).lang;
export const postSlug = (post: Post): string => splitLangSlug(post.id).slug;

/** 文章的本地化访问路径，如 zh → /posts/foo，en → /en/posts/foo */
export function postUrl(post: Post): string {
  const { lang, slug } = splitLangSlug(post.id);
  return localizePath(`/posts/${slug}`, lang);
}

/**
 * 列表↔详情标题 morph 用的 view-transition-name。
 * CSS custom-ident 不能含 '/'（post.id 形如 'zh/foo'），故清洗为合法标识符。
 * 列表卡片与详情页 H1 用同一函数 → 名称一致才能配对成 morph 动效。
 */
export function transitionName(post: Post): string {
  return `post-${post.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

/** 开发模式包含草稿，生产构建剔除 */
const INCLUDE_DRAFTS = import.meta.env.DEV;

/** 指定语言的已发布文章，按发表时间倒序 */
export async function getPosts(locale: Locale): Promise<Post[]> {
  const all = await getCollection('posts', ({ id, data }) => {
    if (splitLangSlug(id).lang !== locale) return false;
    return INCLUDE_DRAFTS ? true : !data.draft;
  });
  return all.sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());
}

/** 指定语言的标签及计数，按计数倒序、同计数按字典序 */
export async function getAllTags(
  locale: Locale,
): Promise<{ tag: string; count: number }[]> {
  const posts = await getPosts(locale);
  const map = new Map<string, number>();
  for (const p of posts) for (const t of p.data.tags) map.set(t, (map.get(t) ?? 0) + 1);
  return [...map.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export async function getPostsByTag(locale: Locale, tag: string): Promise<Post[]> {
  return (await getPosts(locale)).filter((p) => p.data.tags.includes(tag));
}

/** 粗略阅读时长（分钟）：中日韩按字数，拉丁按词数，混排相加 */
const CJK = /[一-鿿぀-ヿ가-힯]/g;
export function readingMinutes(body = ''): number {
  const cjk = (body.match(CJK) || []).length;
  const words = body.replace(CJK, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220 + cjk / 400));
}

/** 上一篇/下一篇（同语言，按时间相邻） */
export function adjacentPosts(
  posts: Post[],
  current: Post,
): { prev?: Post; next?: Post } {
  const i = posts.findIndex((p) => p.id === current.id);
  if (i < 0) return {};
  return { next: posts[i - 1], prev: posts[i + 1] };
}
