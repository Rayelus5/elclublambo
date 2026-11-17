import { RELEASE_NOTES } from '@galaxy/shared';
import { DEFAULT_LOCALE, type Locale } from '../i18n/locales';
import type { LegalKey } from '../i18n/types';
import { SITE } from '../site';
import { esc } from './escape';
import { homePage } from './home';
import { page } from './layout';
import { legalPage } from './legal';
import { movedPage } from './moved';
import { MOVED_CSS } from './moved-css';

export { LEGAL_TOKENS } from './legal';

// The whole landing of galaxysurvivor.es as files (plan «galaxysurvivor.es», PR 4): built once by scripts/prerender.mjs
// (through `vite build --ssr`), then Vite processes the pages' assets and the server serves dist/routes.json.

export interface SiteFile {
  /** The URL path that serves it; null for the 404 page (served for unknown paths). */
  route: string | null;
  /** Its path inside dist/ (pages go through gen/ first). */
  file: string;
  type: 'text/html; charset=utf-8' | 'text/plain; charset=utf-8' | 'application/xml; charset=utf-8' | 'text/css; charset=utf-8';
  body: string;
  /** In the sitemap and without noindex. */
  indexable: boolean;
  /** 'moved': the notice the old address shows (the server's redirect hook serves it, not a route of its own). */
  role?: 'moved';
  /** Written as it is: not a page of the site that goes through Vite (the notice and its stylesheet). */
  raw?: boolean;
}

const LEGAL: { route: string; file: string; key: LegalKey }[] = [
  { route: '/aviso-legal', file: 'aviso-legal.html', key: 'avisoLegal' },
  { route: '/privacidad', file: 'privacidad.html', key: 'privacidad' },
  { route: '/cookies', file: 'cookies.html', key: 'cookies' },
  { route: '/condiciones', file: 'condiciones.html', key: 'condiciones' },
];

export const PAGES: readonly { route: string | null; file: string }[] = [
  { route: '/', file: 'index.html' },
  ...LEGAL.map(({ route, file }) => ({ route, file })),
  { route: null, file: '404.html' },
];

const HTML = 'text/html; charset=utf-8' as const;

function notFound(l: Locale): string {
  const n = l.dict.notFound;
  const main = `<section class="nf wrap"><p class="nf-dots" aria-hidden="true">⠀⠂⠀⠄⠀⠁</p><h1>${esc(n.h1)}</h1><p>${esc(n.text)}</p><a class="lip btn btn-solar" href="${l.prefix}/">${esc(n.back)}</a></section>`;
  return page({ locale: l, title: n.title, description: n.description, path: null, main, bodyClass: 'doc' });
}

function sitemap(l: Locale): string {
  const home = RELEASE_NOTES[0]?.date ?? '2026-11-17';
  const urls = [{ path: '/', lastmod: home }, ...LEGAL.map((p) => ({ path: p.route, lastmod: l.dict.legal.pages[p.key].updated }))];
  const body = urls.map((u) => `  <url>\n    <loc>${SITE.origin}${l.prefix}${u.path}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

const robots = () => `User-agent: *\nAllow: /\nDisallow: /galaxy/api/\n\nSitemap: ${SITE.origin}/sitemap.xml\n`;

/** RFC 9116; it expires a year after the build, so every deploy renews it. */
function securityTxt(now: Date): string {
  const expires = new Date(now.getTime() + 365 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `Contact: mailto:${SITE.contact}\nExpires: ${expires}\nPreferred-Languages: es, en\nCanonical: ${SITE.origin}/.well-known/security.txt\n`;
}

export function renderSite({ now }: { now: Date }): SiteFile[] {
  const l = DEFAULT_LOCALE;
  return [
    { route: '/', file: 'index.html', type: HTML, body: homePage(l), indexable: true },
    ...LEGAL.map((p) => ({ route: p.route, file: p.file, type: HTML, body: legalPage(l, p.key, p.route), indexable: true })),
    { route: null, file: '404.html', type: HTML, body: notFound(l), indexable: false },
    { route: '/robots.txt', file: 'robots.txt', type: 'text/plain; charset=utf-8', body: robots(), indexable: false },
    { route: '/sitemap.xml', file: 'sitemap.xml', type: 'application/xml; charset=utf-8', body: sitemap(l), indexable: false },
    { route: '/.well-known/security.txt', file: '.well-known/security.txt', type: 'text/plain; charset=utf-8', body: securityTxt(now), indexable: false },
    { route: null, file: 'moved.html', type: HTML, body: movedPage(l), indexable: false, role: 'moved', raw: true },
    { route: '/galaxy/mudanza.css', file: 'moved.css', type: 'text/css; charset=utf-8', body: MOVED_CSS, indexable: false, raw: true },
  ];
}
