import { ui, type UIKey } from './ui';
import { LOCALES, DEFAULT_LOCALE, type Locale } from '@/consts';

const LOCALE_SET: ReadonlySet<string> = new Set(LOCALES);

/** 从请求 URL 推断语言：路径首段是 en → en，否则默认（zh）。 */
export function getLocaleFromUrl(url: URL): Locale {
  const seg = url.pathname.split('/').filter(Boolean)[0];
  return seg && LOCALE_SET.has(seg) ? (seg as Locale) : DEFAULT_LOCALE;
}

/** 返回某语言的翻译函数。缺 key 时回退默认语言，再回退 key 本身。 */
export function useTranslations(locale: Locale) {
  return function t(key: UIKey, vars?: Record<string, string | number>): string {
    const raw = ui[locale][key] ?? ui[DEFAULT_LOCALE][key] ?? String(key);
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
  };
}

/** 另一种语言（用于语言切换按钮）。 */
export function getAltLocale(locale: Locale): Locale {
  return locale === 'zh' ? 'en' : 'zh';
}

/**
 * 给「不含语言前缀」的逻辑路径加上当前语言前缀。
 * 约定（见 docs/02-decisions.md §B.3）：zh 在根，en 在 /en/。
 *   localizePath('/', 'zh')      -> '/'
 *   localizePath('/posts', 'zh') -> '/posts'
 *   localizePath('/', 'en')      -> '/en'
 *   localizePath('/posts', 'en') -> '/en/posts'
 */
export function localizePath(path: string, locale: Locale): string {
  const clean = '/' + String(path).replace(/^\/+/, '').replace(/\/+$/, '');
  const normalized = clean === '/' ? '' : clean;
  if (locale === DEFAULT_LOCALE) return normalized || '/';
  return `/${locale}${normalized}`;
}

/** 去掉路径里的语言前缀，得到逻辑路径（用于「保持当前页切换语言」）。 */
export function stripLocale(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] && LOCALE_SET.has(parts[0])) parts.shift();
  return '/' + parts.join('/');
}

/** 切到另一语言时、保持当前逻辑页面的目标 URL。 */
export function switchLocalePath(pathname: string, target: Locale): string {
  return localizePath(stripLocale(pathname), target);
}
