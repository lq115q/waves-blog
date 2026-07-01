import type { Locale } from '@/consts';

const OPTS: Record<Locale, Intl.DateTimeFormatOptions> = {
  zh: { year: 'numeric', month: 'long', day: 'numeric' },
  en: { year: 'numeric', month: 'short', day: 'numeric' },
};

/** 本地化日期，如 zh→2026年6月29日，en→Jun 29, 2026 */
export function formatDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', OPTS[locale]).format(date);
}

/** 机器可读 ISO（datetime 属性 / feeds 用） */
export function isoDate(date: Date): string {
  return date.toISOString();
}
