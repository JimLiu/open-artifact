/** The supported locales for built-in interface text. */
export type UiLocale = 'en' | 'zh-CN';

export function localeOf(language: string | undefined): UiLocale {
  return /^zh(?:-[a-z0-9]{1,8})*$/i.test(language ?? '') ? 'zh-CN' : 'en';
}

/** An explicit preview locale, if the address requests one. */
export function localeOverride(params: URLSearchParams): UiLocale | undefined {
  const language = params.get('lang') ?? undefined;
  if (localeOf(language) === 'zh-CN') return 'zh-CN';
  if (/^en(?:-[a-z0-9]{1,8})*$/i.test(language ?? '')) return 'en';
  return undefined;
}

/** Only browser pages select their preferred locale. Node callers use English. */
export function uiLocale(): UiLocale {
  if (typeof window === 'undefined') return 'en';
  return preferredLocale(window.location?.search ?? '', window.navigator);
}

/** Resolves a page locale from its address and the browser's preferred language. */
export function preferredLocale(search: string, browser?: Pick<Navigator, 'language' | 'languages'>): UiLocale {
  return localeOverride(new URLSearchParams(search)) ?? localeOf(browser?.languages?.[0] ?? browser?.language);
}

const pageLocale = uiLocale();

/** Selects the localized version of a user-facing label or message. */
export function localize(english: string, chinese: string): string {
  return pageLocale === 'zh-CN' ? chinese : english;
}
