import { ES } from './es';
import type { Dict } from './types';

// The languages of the landing (plan «galaxysurvivor.es», PR 4). Spanish is the default and lives at the root; another
// language gets its own prefix (/en/…), its hreflang and its sitemap alternates. No redirect by Accept-Language.
export interface Locale {
  code: string;
  /** '' for the default language, '/en' for English… */
  prefix: string;
  hreflang: string;
  ogLocale: string;
  dict: Dict;
}

export const LOCALES: readonly Locale[] = [{ code: 'es', prefix: '', hreflang: 'es', ogLocale: 'es_ES', dict: ES }];
export const DEFAULT_LOCALE = LOCALES[0]!;
