import { SITE } from '../site';
import type { Locale } from '../i18n/locales';
import { esc } from './escape';
import { head, type HeadOptions } from './seo';

// The frame of every landing page (plan «galaxysurvivor.es», PR 4): the header with «Jugar gratis», the footer with
// the legal links, and the notice phones get instead of the game (the game needs a computer).

/** Links to the home page's sections: plain anchors on the home page, /#… elsewhere. */
const sectionHref = (onHome: boolean, href: string) => (onHome ? href : `/${href}`);

export const LEGAL_LINKS = [
  { key: 'avisoLegal', path: '/aviso-legal' },
  { key: 'privacidad', path: '/privacidad' },
  { key: 'cookies', path: '/cookies' },
  { key: 'condiciones', path: '/condiciones' },
] as const;

const brand = `<a class="brand" href="/"><img src="/favicon.svg" width="34" height="34" alt=""><b>Galaxy<br>Survivor</b></a>`;

export function playLink(locale: Locale, cls = 'lip btn btn-solar') {
  return `<a class="${cls}" href="${SITE.play}" data-play>${esc(locale.dict.cta.play)}</a>`;
}

function header(locale: Locale, onHome: boolean) {
  const d = locale.dict;
  const nav = d.nav.items.map((i) => `<a href="${sectionHref(onHome, i.href)}">${esc(i.label)}</a>`).join('');
  return `<header class="top" id="top"><div class="wrap top-in">${brand}<nav aria-label="${esc(d.nav.label)}">${nav}</nav><div class="acts"><a class="lip btn btn-ghost" href="${SITE.login}">${esc(d.cta.login)}</a>${playLink(locale)}</div></div></header>`;
}

function footer(locale: Locale, onHome: boolean) {
  const d = locale.dict;
  const f = d.footer;
  const legal = LEGAL_LINKS.map((l) => `<li><a href="${locale.prefix}${l.path}">${esc(d.legal.pages[l.key].h1)}</a></li>`).join('');
  return `<footer class="foot"><div class="wrap foot-in">
<div>${brand}<p>${esc(f.tagline)}</p></div>
<div><h2>${esc(f.game)}</h2><ul><li>${playLink(locale, '')}</li><li><a href="${sectionHref(onHome, '#novedades')}">${esc(f.news)}</a></li><li><a href="${sectionHref(onHome, '#preguntas')}">${esc(f.faq)}</a></li></ul></div>
<div><h2>${esc(f.community)}</h2><ul><li><a href="${SITE.discord}" rel="noopener" target="_blank">${esc(f.discord)}</a></li><li><a href="mailto:${SITE.contact}">${SITE.contact}</a></li></ul></div>
<div><h2>${esc(f.legal)}</h2><ul>${legal}</ul></div>
</div></footer>`;
}

/**
 * The notice «Jugar gratis» opens on phones and tablets (client/main.ts), with a share and a copy of the link. Bolder
 * since 2026-11-27, like the game's own notice: a small fleet of probes and «Solo en ordenador» over the title.
 */
function mobileNotice(locale: Locale) {
  const m = locale.dict.mobile;
  const fleet = ['probe-spark', 'probe-lumen', 'probe-prism'].map((p) => `<span class="spr spr-${p}"></span>`).join('');
  return `<dialog id="desktop-only" class="lip panel dlg dlg-mobile" aria-labelledby="dlg-title">
<form method="dialog" class="dlg-x-form"><button class="dlg-x" aria-label="${esc(m.close)}" value="close">✕</button></form>
<div class="dlg-fleet" aria-hidden="true">${fleet}</div>
<span class="dlg-badge">${esc(m.badge)}</span>
<h2 id="dlg-title">${esc(m.title)}</h2>
<p>${esc(m.text)}</p>
<div class="dlg-acts"><button class="lip btn btn-solar" type="button" data-share data-share-text="${esc(m.shareText)}">${esc(m.share)}</button><button class="lip btn btn-ghost" type="button" data-copy data-copied="${esc(m.copied)}">${esc(m.copy)}</button></div>
</dialog>`;
}

export function page(opts: HeadOptions & { main: string; onHome?: boolean; bodyClass?: string }): string {
  const { locale, main, onHome = false, bodyClass = '' } = opts;
  return `<!doctype html>
<html lang="${locale.code}">
<head>
${head(opts)}
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
<a class="skip" href="#main">${esc(locale.dict.meta.skip)}</a>
${header(locale, onHome)}
<main id="main">
${main}
</main>
${footer(locale, onHome)}
${mobileNotice(locale)}
</body>
</html>
`;
}
