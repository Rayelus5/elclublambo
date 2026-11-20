import type { Locale } from '../i18n/locales';
import type { LegalBlock, LegalKey } from '../i18n/types';
import { esc, inline } from './escape';
import { page } from './layout';
import { breadcrumb } from './seo';

// The legal pages (plan «galaxysurvivor.es», PR 4). The holder's legal name, NIF and address are never in this public
// repository: each goes in its own line, `<li data-legal-line="nif">NIF: <!--legal:nif--></li>`, which the server fills
// from galaxy.env (apps/server/src/landing.ts) or removes when the datum is missing.

export const LEGAL_TOKENS = ['holder', 'nif', 'address'] as const;
export type LegalToken = (typeof LEGAL_TOKENS)[number];

function block(b: LegalBlock): string {
  if ('p' in b) return `<p>${inline(b.p)}</p>`;
  if ('ul' in b) return `<ul>${b.ul.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`;
  const id = b.identity;
  const line = (t: LegalToken) => `<li data-legal-line="${t}">${esc(id[t])}<!--legal:${t}--></li>`;
  return `<ul class="identity"><li>${esc(id.tradeName)}</li>${LEGAL_TOKENS.map(line).join('')}<li>${inline(id.contact)}</li></ul>`;
}

export function legalPage(l: Locale, key: LegalKey, path: string): string {
  const p = l.dict.legal.pages[key];
  const sections = p.sections
    .map((s) => `<section${s.id ? ` id="${s.id}"` : ''}><h2>${esc(s.title)}</h2>${s.blocks.map(block).join('')}</section>`)
    .join('\n');
  const main = `<article class="wrap legal">
<nav class="crumbs" aria-label="${esc(l.dict.legal.crumbs)}"><a href="${l.prefix}/">${esc(l.dict.legal.home)}</a><span aria-hidden="true">/</span><span>${esc(p.h1)}</span></nav>
<h1>${esc(p.h1)}</h1>
<p class="updated">${esc(l.dict.legal.updated(p.updated))}</p>
<p class="intro">${inline(p.intro)}</p>
${sections}
</article>`;
  return page({ locale: l, title: p.title, description: p.description, path, ld: [breadcrumb(l, p.h1, path)], main, bodyClass: 'doc' });
}
