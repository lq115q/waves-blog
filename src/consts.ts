/**
 * 站点级常量与配置 —— 单一真源。
 * 所有 layouts / pages / feeds / OG 通过 `@/consts` 引用，禁止散落硬编码。
 * 决策依据见 docs/02-decisions.md。
 */

export const LOCALES = ['zh', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'zh';

/** 站点规范 URL：默认真实域名；构建期可由环境变量 SITE 覆盖（astro.config 的 `site`）。 */
export const SITE_URL: string =
  import.meta.env.SITE ?? 'https://blog.wavespro.net';

export const SITE = {
  /** 站点标识（与语言无关的品牌名） */
  name: 'Waves',
  /** 作者 */
  author: 'Waves',
  /** 邮箱（OG/Feed 可用，非必填） */
  email: '',
  /** GitHub / 社交（留空则不渲染） */
  social: {
    github: '',
    x: '',
  },
  /** 每页文章数 */
  postsPerPage: 10,
  /** OG 图默认强调色（与 --accent 对齐） */
  ogAccent: '#34d399',
  ogBackground: '#0a0f0d',
} as const;

/** 多语言站点元信息（标题/描述按语言区分） */
export const SITE_META: Record<Locale, { title: string; description: string }> = {
  zh: {
    title: 'Waves\' Blog',
    description: 'Security Blog',
  },
  en: {
    title: 'Waves\' Blog',
    description: 'Security Blog',
  },
};

/** 主导航（key 用于 i18n 文案查表，path 为不含语言前缀的路径） */
export const NAV: { key: 'posts' | 'tags' | 'about' | 'search'; path: string }[] = [
  { key: 'posts', path: '/posts' },
  { key: 'tags', path: '/tags' },
  { key: 'about', path: '/about' },
  { key: 'search', path: '/search' },
];
