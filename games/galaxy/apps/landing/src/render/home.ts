import { RELEASE_NOTES } from '@galaxy/shared';
import GALAXIES from '../assets/galaxies/galaxies.json';
import { SITE } from '../site';
import type { Locale } from '../i18n/locales';
import type { Dict, Stop } from '../i18n/types';
import { esc } from './escape';
import { page, playLink } from './layout';
import { absolute, orgNode, SRC } from './seo';

// The landing «Viaje de la sonda» (plan «galaxysurvivor.es», PR 4; the owner approved mock-up B, 2026-11-17): you
// scroll, the probe flies down a dotted route through every stop, each with its sector's light (data-biome), and docks
// at the station at the end (data-dock). data-anchor is where the route crosses each stop, in % of the width: 50 weaves
// through the centre lane of a two-column stop; 5 and 95 swing it to the side of a centred one, never over its text.
// Everything moving lives in client/main.ts and the CSS; this HTML is complete without them.

type Clip = keyof Dict['clips'];
const CLIP_SIZE = { w: 960, h: 540 };

const kicker = (text: string, tone: string) => `<span class="kicker k-${tone}">${esc(text)}</span>`;
const heading = (s: Stop, tone: string) => `${kicker(s.kicker, tone)}<h2 class="h2">${esc(s.title)}</h2><p class="sub">${esc(s.text)}</p>`;
const points = (items: string[], tone: string) => `<ul class="points k-${tone}">${items.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;

/** A clip in the left or right column; its radar ping opens from the side facing the route (the centre lane). */
function clip(d: Dict, name: Clip, col: 'l' | 'r') {
  return `<div class="${col} ping from-${col === 'r' ? 'left' : 'right'}"><video class="clip" muted loop playsinline preload="none" width="${CLIP_SIZE.w}" height="${CLIP_SIZE.h}" poster="${SRC}/assets/posters/${name}.webp" aria-label="${esc(d.clips[name])}"><source src="${SRC}/assets/clips/${name}.mp4" type="video/mp4"></video></div>`;
}

const sprite = (name: string) => `<span class="spr spr-${name}" aria-hidden="true"></span>`;

interface StopOpts {
  id?: string;
  biome: string;
  anchor: number;
  center?: boolean;
  extra?: string;
}
const stop = (o: StopOpts, inner: string) =>
  `<section class="stop${o.center ? ' center' : ''}${o.extra ? ` ${o.extra}` : ''}"${o.id ? ` id="${o.id}"` : ''} data-biome="${o.biome}" data-anchor="${o.anchor}">\n<div class="wrap${o.center ? '' : ' lane'}">${inner}</div>\n</section>`;

function hero(l: Locale) {
  const d = l.dict;
  return `<section class="hero" data-biome="#3346b8" data-anchor="50">
<div class="station" aria-hidden="true"></div><div class="planet" aria-hidden="true"></div>
<div class="wrap">
<h1>${esc(d.hero.h1[0])} <span>${esc(d.hero.h1[1])}</span></h1>
<p class="lead">${esc(d.hero.lead)}</p>
<div class="ctas">${playLink(l, 'lip btn btn-xl btn-solar')}<a class="lip btn btn-ghost" href="#hangar">${esc(d.cta.follow)}</a></div>
</div>
<div class="pad" aria-hidden="true"></div>
</section>`;
}

function levelUp(d: Dict) {
  const art = ['weapon-arc', 'weapon-beam-prism', 'weapon-drone'];
  const tone = ['terminal', 'solar', 'ice'];
  const cards = d.levelUp.cards
    .map((c, i) => `<div class="lip panel up up-${i + 1}"><span class="tag tag-${tone[i]}">${esc(c.tag)}</span>${sprite(art[i]!)}<b>${esc(c.name)}</b><small>${esc(c.text)}</small></div>`)
    .join('');
  return `<div class="txt">${heading(d.levelUp, 'uv')}</div><div class="levelup">${cards}</div>`;
}

function station(d: Dict) {
  const art = ['room-scanner', 'room-hangar', 'room-lab', 'room-refinery', 'room-planetarium', 'room-antenna'];
  const rooms = d.station.rooms.map((r, i) => `<div class="lip panel room">${sprite(art[i]!)}<b>${esc(r)}</b></div>`).join('');
  return `<div class="l txt">${heading(d.station, 'ice')}</div><div class="r rooms">${rooms}</div>`;
}

function scanner(d: Dict) {
  const order = ['rare', 'epic', 'legendary', 'uncommon', 'mythic'] as const;
  const cards = order
    .map((t) => {
      const g = GALAXIES[t];
      const tier = d.scanner.cardTier[t];
      return `<article class="gcard" data-tier="${t}"><img src="${SRC}/assets/galaxies/${t}.webp" width="400" height="400" alt="${esc(`${g.name}, ${tier}`)}" loading="lazy"><span class="lv">${esc(d.scanner.level)}</span><div class="plate"><b>${esc(g.name)}</b><small>${esc(g.designation)}</small><i>${esc(tier)}</i></div></article>`;
    })
    .join('');
  const tiers = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
  return `<div class="txt">${heading(d.scanner, 'solar')}</div><div class="hand">${cards}</div>
<ul class="tiers">${d.scanner.tiers.map((t, i) => `<li class="t-${tiers[i]}">${esc(t)}</li>`).join('')}</ul>
<p class="count">${esc(d.scanner.count)}</p><p class="count-text">${esc(d.scanner.countText)}</p>`;
}

function group(d: Dict) {
  const wing = ['probe-spark', 'probe-prism', 'probe-comet', 'probe-lumen'].map(sprite).join('');
  return `${clip(d, 'coop', 'l')}<div class="r txt">${heading(d.group, 'sky')}<div class="wing">${wing}</div><span class="server">${esc(d.group.server)}</span></div>`;
}

function community(d: Dict) {
  const art = ['clanes', 'mercado', 'temporada', 'torneo', 'evento'];
  const tiles = d.community.tiles
    .map((t, i) => `<article class="lip panel tile"><img src="${SRC}/assets/banners/${art[i]}.webp" width="640" height="360" alt="${esc(t.alt)}" loading="lazy"><div><h3>${esc(t.title)}</h3><p>${esc(t.text)}</p></div></article>`)
    .join('');
  return `<div class="txt">${heading(d.community, 'mythic')}</div><div class="comm">${tiles}</div>`;
}

function lore(d: Dict) {
  return `<div class="txt">${kicker(d.lore.kicker, 'terminal')}<h2 class="h2">${esc(d.lore.title)}</h2></div>
<div class="lip panel radio"><div class="who" aria-hidden="true">⠏</div><div><b>${esc(d.lore.who)}</b>${d.lore.lines.map((l) => `<p class="line">${esc(l)}</p>`).join('')}</div></div>`;
}

function news(d: Dict) {
  const notes = RELEASE_NOTES.slice(0, 3)
    .map((n) => `<article class="lip panel notecard"><small>${esc(d.news.version(n.version, n.date))}</small><h3>${esc(n.title)}</h3><p>${esc(n.summary ?? '')}</p></article>`)
    .join('');
  return `<div class="txt">${heading(d.news, 'solar')}</div><div class="notes">${notes}</div>`;
}

function faq(d: Dict) {
  const items = d.faq.items.map((q, i) => `<details class="lip panel"${i === 0 ? ' open' : ''}><summary>${esc(q.q)}</summary><p>${esc(q.a)}</p></details>`).join('');
  return `<div class="txt">${kicker(d.faq.kicker, 'ice')}<h2 class="h2">${esc(d.faq.title)}</h2></div><div class="faq">${items}</div>`;
}

function final(l: Locale) {
  const d = l.dict;
  return `<section class="stop center final" data-biome="#3346b8" data-anchor="50" data-dock>
<div class="wrap txt"><div class="dock" aria-hidden="true"></div>
<h2 class="h2 h2-xl">${esc(d.final.title)}</h2><p class="sub">${esc(d.final.text)}</p>
<div class="ctas">${playLink(l, 'lip btn btn-xl btn-solar')}<a class="lip btn btn-ghost" href="${SITE.login}">${esc(d.cta.login)}</a></div>
<p class="note">${esc(d.final.note)}</p></div>
</section>`;
}

/** The probe's route over the whole page and the probe itself; drawn by client/main.ts (desktop, motion allowed). */
const route = `<div class="route" id="route" aria-hidden="true"><svg id="route-svg"><defs><linearGradient id="trail-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc94a"/><stop offset=".35" stop-color="#ff6b7a"/><stop offset=".7" stop-color="#9b86ff"/><stop offset="1" stop-color="#bfe3ff"/></linearGradient><clipPath id="clip-lit"><rect id="clip-rect" x="0" y="0" width="100%" height="0"/></clipPath></defs><path class="trail" id="trail"/><path class="lit" id="lit" clip-path="url(#clip-lit)"/></svg><div class="probe" id="probe"><span class="flame"></span>${sprite('probe-spark')}</div></div>`;

function structuredData(l: Locale) {
  const d = l.dict;
  return [
    {
      '@context': 'https://schema.org',
      '@graph': [
        orgNode(),
        { '@type': 'WebSite', '@id': `${SITE.origin}/#website`, url: `${SITE.origin}/`, name: SITE.name, inLanguage: l.code, publisher: { '@id': `${SITE.origin}/#org` } },
        {
          '@type': 'VideoGame',
          '@id': `${SITE.origin}/#game`,
          name: SITE.name,
          url: `${SITE.origin}/`,
          description: d.meta.description,
          image: absolute(SITE.ogImage),
          screenshot: SITE.shots.map((s) => absolute(s)),
          genre: ['Roguelite', 'Acción', 'Supervivencia', 'Coleccionables'],
          gamePlatform: ['Navegador web', 'PC'],
          applicationCategory: 'Game',
          operatingSystem: 'Windows, macOS, Linux',
          playMode: ['SinglePlayer', 'CoOp'],
          numberOfPlayers: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 4 },
          inLanguage: l.code,
          isAccessibleForFree: true,
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR', availability: 'https://schema.org/InStock', url: absolute(SITE.play) },
          publisher: { '@id': `${SITE.origin}/#org` },
          author: { '@id': `${SITE.origin}/#org` },
        },
        {
          '@type': 'FAQPage',
          mainEntity: d.faq.items.map((q) => ({ '@type': 'Question', name: q.q, acceptedAnswer: { '@type': 'Answer', text: q.a } })),
        },
      ],
    },
  ];
}

export function homePage(l: Locale): string {
  const d = l.dict;
  const main = [
    route,
    '<div class="sky" aria-hidden="true"><i class="l1"></i><i class="l2"></i><i class="l3"></i></div>',
    hero(l),
    stop({ id: 'hangar', biome: '#4a3bb0', anchor: 50 }, `<div class="l txt">${heading(d.hangar, 'uv')}${points(d.hangar.points, 'uv')}</div>${clip(d, 'lobby', 'r')}`),
    stop({ id: 'incursion', biome: '#13805c', anchor: 50 }, `${clip(d, 'horde', 'l')}<div class="r txt">${heading(d.run, 'terminal')}</div>`),
    stop({ biome: '#5a43d6', anchor: 5, center: true }, levelUp(d)),
    stop(
      { id: 'nucleo', biome: '#b0283f', anchor: 50, extra: 'boss' },
      `<div class="l txt">${heading(d.boss, 'nova')}<div class="hp" id="hp" role="img" aria-label="${esc(d.boss.health)}"><i></i></div><div class="hp-l"><span>${esc(d.boss.name)}</span><span id="hp-n">100 %</span></div></div>${clip(d, 'boss', 'r')}`,
    ),
    stop({ biome: '#1d7a8a', anchor: 50 }, `${clip(d, 'extract', 'l')}<div class="r txt">${heading(d.extract, 'ice')}</div>`),
    stop({ id: 'estacion', biome: '#2c6fb0', anchor: 50 }, station(d)),
    stop({ id: 'escaner', biome: '#8a6a12', anchor: 95, center: true }, scanner(d)),
    stop({ id: 'reliquias', biome: '#6a3fb8', anchor: 50 }, `<div class="l txt">${heading(d.relics, 'epic')}${points(d.relics.points, 'epic')}</div>${clip(d, 'collection', 'r')}`),
    stop({ id: 'grupo', biome: '#3a58e0', anchor: 50 }, group(d)),
    stop({ id: 'comunidad', biome: '#7a2fa0', anchor: 5, center: true }, community(d)),
    stop({ id: 'historia', biome: '#0f6b52', anchor: 95, center: true }, lore(d)),
    stop({ id: 'novedades', biome: '#3346b8', anchor: 5, center: true }, news(d)),
    stop({ id: 'preguntas', biome: '#2a3a9a', anchor: 95, center: true }, faq(d)),
    final(l),
  ].join('\n');
  return page({ locale: l, title: d.meta.title, description: d.meta.description, path: '/', ld: structuredData(l), main, onHome: true, bodyClass: 'home' });
}
