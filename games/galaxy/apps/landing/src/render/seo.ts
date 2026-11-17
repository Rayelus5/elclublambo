import { SITE } from '../site';
import type { Locale } from '../i18n/locales';
import { esc, ldJson } from './escape';

// The <head> of every landing page (plan «galaxysurvivor.es», PR 4): title, description, canonical with its hreflang,
// Open Graph and Twitter cards, icons, the page's CSS and JS (paths Vite rewrites: the pages are built from gen/), and
// its structured data.

/** Source paths as seen from gen/*.html (Vite resolves and hashes them). */
export const SRC = '../src';

export interface HeadOptions {
  locale: Locale;
  title: string;
  description: string;
  /** The page's path ('/', '/privacidad'); null for the 404 (no canonical, not indexed). */
  path: string | null;
  ld?: unknown[];
}

export const absolute = (path: string) => SITE.origin + path;

export function head({ locale, title, description, path, ld = [] }: HeadOptions): string {
  const d = locale.dict;
  const url = path === null ? null : absolute(locale.prefix + path);
  const image = absolute(SITE.ogImage);
  const tags = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    path === null ? '<meta name="robots" content="noindex">' : '',
    url ? `<link rel="canonical" href="${url}">` : '',
    url ? `<link rel="alternate" hreflang="${locale.hreflang}" href="${url}">` : '',
    url ? `<link rel="alternate" hreflang="x-default" href="${url}">` : '',
    '<meta name="theme-color" content="#070a1c">',
    '<meta name="color-scheme" content="dark">',
    '<link rel="icon" href="/favicon.ico" sizes="48x48">',
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${esc(d.meta.siteName)}">`,
    `<meta property="og:locale" content="${locale.ogLocale}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    url ? `<meta property="og:url" content="${url}">` : '',
    `<meta property="og:image" content="${image}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${esc(d.meta.ogImageAlt)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${image}">`,
    `<link rel="stylesheet" href="${SRC}/styles/landing.css">`,
    `<script type="module" src="${SRC}/client/main.ts"></script>`,
    ...ld.map(ldJson),
  ];
  return tags.filter(Boolean).join('\n');
}

/** The organisation and the website, shared by every page's graph. */
export const orgNode = () => ({
  '@type': 'Organization',
  '@id': `${SITE.origin}/#org`,
  name: SITE.company,
  url: `${SITE.origin}/`,
  logo: absolute('/icon-512.png'),
  email: SITE.contact,
  sameAs: [SITE.discord],
});

export const breadcrumb = (locale: Locale, name: string, path: string) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: locale.dict.legal.home, item: absolute(locale.prefix + '/') },
    { '@type': 'ListItem', position: 2, name, item: absolute(locale.prefix + path) },
  ],
});
