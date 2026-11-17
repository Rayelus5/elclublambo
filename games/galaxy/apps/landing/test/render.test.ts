import { RELEASE_NOTES } from '@galaxy/shared';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { LEGAL_TOKENS, PAGES, renderSite } from '../src/render/entry';

// The landing of galaxysurvivor.es (plan «galaxysurvivor.es», PR 4; spec docs/superpowers/specs/2026-11-17-galaxy-
// portada-design.md): every page carries its full SEO head, nothing the server's CSP would block, and the copy the
// owner chose.

const NOW = new Date('2026-11-17T12:00:00Z');
const files = renderSite({ now: NOW });
const byFile = (f: string) => files.find((x) => x.file === f)!;
const pages = files.filter((f) => f.type.startsWith('text/html'));
const ORIGIN = 'https://galaxysurvivor.es';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON-LD read back from the page
type Json = any;
const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const all = (html: string, re: RegExp) => [...html.matchAll(re)];
const meta = (html: string, attr: 'name' | 'property', key: string) =>
  html.match(new RegExp(`<meta ${attr}="${key.replace(/[.:]/g, '\\$&')}" content="([^"]*)"`))?.[1];

test('cinco páginas indexables y un 404, cada una con su archivo', () => {
  expect(PAGES.map((p) => [p.route, p.file])).toEqual([
    ['/', 'index.html'],
    ['/aviso-legal', 'aviso-legal.html'],
    ['/privacidad', 'privacidad.html'],
    ['/cookies', 'cookies.html'],
    ['/condiciones', 'condiciones.html'],
    [null, '404.html'],
  ]);
  for (const p of PAGES) expect(byFile(p.file)).toBeDefined();
});

test('cada página tiene su cabecera de SEO completa', () => {
  for (const f of pages) {
    const h = f.body;
    expect(h, f.file).toMatch(/^<!doctype html>\n<html lang="es">/);
    expect(all(h, /<h1[\s>]/g), f.file).toHaveLength(1);
    const title = h.match(/<title>([^<]*)<\/title>/)![1]!;
    expect(title.length, f.file).toBeLessThanOrEqual(60);
    const desc = meta(h, 'name', 'description')!;
    expect(desc.length, f.file).toBeGreaterThanOrEqual(70);
    expect(desc.length, f.file).toBeLessThanOrEqual(160);
    expect(h).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(h).toContain('<meta name="theme-color" content="#070a1c">');
    expect(h).toContain('<link rel="icon" href="/favicon.ico" sizes="48x48">');
    expect(h).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
    expect(meta(h, 'property', 'og:locale')).toBe('es_ES');
    expect(meta(h, 'property', 'og:image')).toBe(`${ORIGIN}/og/og-es-v1.jpg`);
    expect(meta(h, 'name', 'twitter:card')).toBe('summary_large_image');
    if (!f.indexable) continue;
    const canonical = h.match(/<link rel="canonical" href="([^"]+)">/)![1]!;
    expect(canonical).toBe(ORIGIN + (f.route === '/' ? '/' : f.route));
    expect(h).toContain(`<link rel="alternate" hreflang="es" href="${canonical}">`);
    expect(h).toContain(`<link rel="alternate" hreflang="x-default" href="${canonical}">`);
    expect(meta(h, 'property', 'og:url')).toBe(canonical);
    expect(meta(h, 'property', 'og:title')).toBeTruthy();
    expect(meta(h, 'property', 'og:description')).toBe(desc);
  }
});

test('nada que la CSP del servidor bloquee: sin estilos ni manejadores en línea, solo JSON-LD como script', () => {
  for (const f of pages) {
    expect(f.body, f.file).not.toMatch(/\sstyle=/);
    expect(f.body, f.file).not.toMatch(/\son[a-z]+=/);
    for (const [tag] of all(f.body, /<script\b[^>]*>/g)) expect(tag, f.file).toMatch(/type="(module|application\/ld\+json)"/);
    for (const [, json] of all(f.body, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      const data = JSON.parse(json!);
      expect(data['@context']).toBe('https://schema.org');
      expect(data['@type'] ?? data['@graph']).toBeTruthy();
    }
  }
});

test('las imágenes llevan medidas y texto alternativo; los clips no se descargan hasta que se ven', () => {
  for (const f of pages) {
    for (const [img] of all(f.body, /<img\b[^>]*>/g)) {
      expect(img, f.file).toMatch(/\swidth="\d+"/);
      expect(img, f.file).toMatch(/\sheight="\d+"/);
      expect(img, f.file).toMatch(/\salt="/);
    }
  }
  const home = byFile('index.html').body;
  const videos = all(home, /<video\b[^>]*>/g);
  expect(videos.length).toBe(6);
  for (const [v] of videos) {
    expect(v).toMatch(/\spreload="none"/);
    expect(v).toMatch(/\smuted\b/);
    expect(v).toMatch(/\sposter="[^"]+\.webp"/);
    expect(v).toMatch(/\saria-label="[^"]+"/);
  }
});

test('los enlaces internos van a páginas que existen, al juego o a un ancla de la página', () => {
  const routes = new Set(PAGES.map((p) => p.route).filter(Boolean));
  for (const f of pages) {
    const ids = new Set(all(f.body, /\sid="([^"]+)"/g).map((m) => m[1]));
    for (const [, href] of all(f.body, /<a\b[^>]*\shref="([^"]+)"/g)) {
      if (/^(https:|mailto:)/.test(href!)) continue;
      if (href!.startsWith('#')) expect(ids.has(href!.slice(1)), `${f.file} ${href}`).toBe(true);
      else if (href!.startsWith('/galaxy/')) expect(href).toMatch(/^\/galaxy\/(crear-cuenta|entrar)$/);
      else expect(routes.has(href!.split('#')[0]!), `${f.file} ${href}`).toBe(true);
    }
  }
});

test('los títulos de sección no llevan punto final ni símbolos', () => {
  for (const f of pages) {
    for (const [, inner] of all(f.body, /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/g)) {
      const t = textOf(inner!);
      expect(t, f.file).not.toMatch(/[·—→]|\.$/);
    }
  }
});

test('la portada: el título, el H1 y la descripción que eligió el propietario, con «Jugar gratis» al juego', () => {
  const h = byFile('index.html').body;
  expect(h).toContain('<title>Galaxy Survivor | Roguelite de hordas gratis en el navegador</title>');
  expect(textOf(h.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)![1]!)).toBe('Sobrevive a la Estática');
  expect(all(h, /<a\b[^>]*href="\/galaxy\/crear-cuenta"[^>]*data-play[^>]*>\s*Jugar gratis\s*<\/a>/g).length).toBeGreaterThanOrEqual(2);
  expect(h).toContain('href="/galaxy/entrar"');
  // The probe's route stops: every section anchors it; the last one docks at the station.
  expect(all(h, /<section\b[^>]*\sdata-anchor="\d+"/g).length).toBe(15);
  expect(h).toMatch(/<section\b[^>]*\sdata-dock[\s>]/);
  // The mobile notice exists for «Jugar gratis» on phones.
  expect(h).toMatch(/<dialog\b[^>]*id="desktop-only"/);
});

test('las novedades son las tres últimas notas de versión, con su resumen', () => {
  const h = byFile('index.html').body;
  for (const n of RELEASE_NOTES.slice(0, 3)) {
    expect(h).toContain(n.title.replace(/&/g, '&amp;'));
    expect(h).toContain(n.summary!.replace(/&/g, '&amp;'));
  }
  expect(h).not.toContain(RELEASE_NOTES[3]!.title);
});

test('el JSON-LD de la portada: juego gratis de 1 a 4, la web, la organización y las preguntas', () => {
  const h = byFile('index.html').body;
  const graph = JSON.parse(h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!)['@graph'] as Record<string, unknown>[];
  const of = (t: string) => graph.find((n) => n['@type'] === t)!;
  expect(graph.map((n) => n['@type']).sort()).toEqual(['FAQPage', 'Organization', 'VideoGame', 'WebSite']);
  const game = of('VideoGame') as Json;
  expect(game.name).toBe('Galaxy Survivor');
  expect(game.url).toBe(`${ORIGIN}/`);
  expect(game.isAccessibleForFree).toBe(true);
  expect(game.offers).toMatchObject({ '@type': 'Offer', price: '0', priceCurrency: 'EUR' });
  expect(game.numberOfPlayers).toMatchObject({ minValue: 1, maxValue: 4 });
  expect(game.playMode).toEqual(['SinglePlayer', 'CoOp']);
  expect(game.inLanguage).toBe('es');
  expect(game.aggregateRating).toBeUndefined();
  expect((of('Organization') as Json).name).toBe('GALAXY SURVIVOR');
  expect((of('Organization') as Json).email).toBe('contacto@rayelus.com');
  const faq = of('FAQPage') as Json;
  expect(faq.mainEntity.length).toBeGreaterThanOrEqual(4);
  for (const q of faq.mainEntity) expect(h).toContain(q.name);
});

test('las páginas legales: migas, el titular con sus líneas que rellena el servidor, el contacto', () => {
  for (const file of ['aviso-legal.html', 'privacidad.html', 'cookies.html', 'condiciones.html']) {
    const h = byFile(file).body;
    const ld = all(h, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g).map((m) => JSON.parse(m[1]!));
    expect(ld.some((d) => d['@type'] === 'BreadcrumbList'), file).toBe(true);
    expect(h, file).toContain('GALAXY SURVIVOR');
    expect(h, file).toContain('contacto@rayelus.com');
  }
  const aviso = byFile('aviso-legal.html').body;
  for (const t of LEGAL_TOKENS) expect(aviso).toMatch(new RegExp(`<li data-legal-line="${t}">[^<]*<!--legal:${t}--></li>`));
  expect(byFile('condiciones.html').body).toMatch(/\sid="compras"/);
  expect(byFile('condiciones.html').body).toMatch(/\sid="uso"/);
});

test('el 404 no se indexa y no está en el mapa del sitio', () => {
  const h = byFile('404.html').body;
  expect(h).toContain('<meta name="robots" content="noindex">');
  expect(byFile('404.html').indexable).toBe(false);
  expect(byFile('sitemap.xml').body).not.toContain('404');
});

test('robots.txt deja rastrear todo menos la API y apunta al mapa del sitio', () => {
  const r = byFile('robots.txt');
  expect(r.type).toBe('text/plain; charset=utf-8');
  expect(r.body).toBe(`User-agent: *\nAllow: /\nDisallow: /galaxy/api/\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
});

test('sitemap.xml: las cinco páginas indexables, con su fecha fija', () => {
  const s = byFile('sitemap.xml');
  expect(s.type).toBe('application/xml; charset=utf-8');
  const locs = all(s.body, /<loc>([^<]+)<\/loc>/g).map((m) => m[1]);
  expect(locs).toEqual(['/', '/aviso-legal', '/privacidad', '/cookies', '/condiciones'].map((p) => ORIGIN + p));
  expect(s.body).toContain(`<lastmod>${RELEASE_NOTES[0]!.date}</lastmod>`);
  expect(s.body).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
});

test('security.txt: contacto y caducidad a un año de la compilación', () => {
  const s = byFile('.well-known/security.txt');
  expect(s.body).toContain('Contact: mailto:contacto@rayelus.com');
  const expires = new Date(s.body.match(/Expires: (\S+)/)![1]!);
  expect(expires.getTime() - NOW.getTime()).toBeGreaterThan(30 * 86_400_000);
});

test('los colores de la portada son los del juego', () => {
  const css = readFileSync(new URL('../src/styles/landing.css', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../../web/src/styles/app.css', import.meta.url), 'utf8');
  for (const [mine, theirs] of [['--void', '--color-void'], ['--panel', '--color-panel'], ['--lip', '--color-panel-lip'], ['--solar', '--color-solar'], ['--ice', '--color-ice'], ['--nova', '--color-nova']]) {
    const a = css.match(new RegExp(`${mine}:\\s*(#[0-9a-f]{6})`))?.[1];
    const b = app.match(new RegExp(`${theirs}:\\s*(#[0-9a-f]{6})`))?.[1];
    expect(a, mine).toBe(b);
  }
});

