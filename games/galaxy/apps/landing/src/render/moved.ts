import type { Locale } from '../i18n/locales';
import { esc } from './escape';

// The notice on the old address (the owner, 2026-11-17): once the game lives at galaxysurvivor.es, a browser opening a
// page of pre.elclub.party/galaxy gets this card instead of the game, with one button to the same page on the new
// domain. The server fills {{href}} (escaped) per request. It is served on the old host, where only /galaxy reaches this
// server: its stylesheet is /galaxy/mudanza.css and its fonts /galaxy/fonts; nothing comes from the site root.

/** The braille logo (apps/web/public/favicon.svg), drawn with attributes only: no inline style under the CSP. */
const LOGO =
  '<svg class="logo" viewBox="0 0 16 16" width="64" height="64" aria-hidden="true"><rect width="16" height="16" rx="4" fill="#070a1c"/><g fill="#ffc94a"><circle cx="5" cy="4" r="1.4"/><circle cx="5" cy="8" r="1.4"/><circle cx="11" cy="8" r="1.4"/></g><g fill="#bfe3ff"><circle cx="11" cy="4" r="1.4"/><circle cx="5" cy="12" r="1.4"/><circle cx="11" cy="12" r="1.4"/></g></svg>';

export function movedPage(l: Locale): string {
  const m = l.dict.moved;
  return `<!doctype html>
<html lang="${l.code}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(m.title)}</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="{{href}}">
<meta name="theme-color" content="#070a1c">
<meta name="color-scheme" content="dark">
<link rel="icon" href="/galaxy/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/galaxy/mudanza.css">
</head>
<body>
<main class="moved">
<section class="card" aria-labelledby="moved-title">
${LOGO}
<h1 id="moved-title">${esc(m.title)}</h1>
<p>${esc(m.text)}</p>
<a class="btn" href="{{href}}">${esc(m.button)}</a>
<p class="note">${esc(m.note)}</p>
</section>
</main>
</body>
</html>
`;
}
