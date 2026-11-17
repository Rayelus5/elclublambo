import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { renderShell, SHELL_MARKER, type ShellRequest } from '../../src/static';

// The game's shell with its own head (galaxysurvivor.es plan, PR 2): each screen's title, a description, the theme and
// icons, and Open Graph and Twitter cards with absolute URLs so an invite link previews well. Every /galaxy page is
// noindex (they need a session or a computer: only the landing and its legal pages are indexed), and the manifest is
// only offered on the canonical host (or with none configured, in dev and e2e), so pre.elclub.party never installs.

const TEMPLATE = [
  '<!doctype html>',
  '<html lang="es">',
  '  <head>',
  '    <meta charset="utf-8" />',
  '    <link rel="icon" href="/galaxy/favicon.svg" type="image/svg+xml" />',
  '    <title>Galaxy Survivor</title>',
  `    ${SHELL_MARKER}`,
  '    <script type="module" crossorigin src="/galaxy/assets/index-abc.js"></script>',
  '  </head>',
  '  <body><div id="root"></div></body>',
  '</html>',
].join('\n');

const CANONICAL = 'https://galaxysurvivor.es';
const req = (url: string, host = 'galaxysurvivor.es', protocol = 'https'): ShellRequest => ({ url, host, protocol });
const render = (r: ShellRequest, canonicalOrigin: string | null = CANONICAL, template = TEMPLATE) => renderShell(r, { template, canonicalOrigin });

const titleOf = (html: string) => [...html.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]);
const meta = (html: string, attr: 'name' | 'property', key: string) => new RegExp(`<meta ${attr}="${key}" content="([^"]*)">`).exec(html)?.[1];

describe('el título de cada pantalla', () => {
  test('cada prefijo lleva el título de su pantalla, y solo uno', () => {
    expect(titleOf(render(req('/galaxy/')))).toEqual(['Galaxy Survivor']);
    expect(titleOf(render(req('/galaxy/escaner')))).toEqual(['Escáner profundo | Galaxy Survivor']);
    expect(titleOf(render(req('/galaxy/crear-cuenta?ref=ABCD')))).toEqual(['Crear cuenta | Galaxy Survivor']);
    expect(titleOf(render(req('/galaxy/perfil/vega/coleccion')))).toEqual(['Colección de un jugador | Galaxy Survivor']);
    expect(titleOf(render(req('/galaxy/admin/jugadores/vega')))).toEqual(['Administración | Galaxy Survivor']);
  });

  test('una ruta que no existe se queda con el título del juego', () => {
    for (const url of ['/galaxy/nada', '/galaxy/a/b/c', '/galaxy/index.html']) expect(titleOf(render(req(url))), url).toEqual(['Galaxy Survivor']);
  });

  test('las tarjetas de Open Graph y Twitter llevan el mismo título y la descripción', () => {
    const html = render(req('/galaxy/estacion'));
    expect(meta(html, 'property', 'og:title')).toBe('Estación | Galaxy Survivor');
    expect(meta(html, 'name', 'twitter:title')).toBe('Estación | Galaxy Survivor');
    const description = meta(html, 'name', 'description');
    expect(description?.length).toBeGreaterThan(70);
    expect(meta(html, 'property', 'og:description')).toBe(description);
    expect(meta(html, 'name', 'twitter:card')).toBe('summary_large_image');
  });
});

describe('la cabecera', () => {
  test('todas las páginas del juego son noindex, con su color e iconos', () => {
    const html = render(req('/galaxy/entrar'));
    expect(meta(html, 'name', 'robots')).toBe('noindex');
    expect(meta(html, 'name', 'theme-color')).toBe('#070a1c');
    expect(html).toContain('<link rel="icon" href="/galaxy/icons/icon-192.png" sizes="192x192" type="image/png">');
    expect(html).toContain('<link rel="apple-touch-icon" href="/galaxy/icons/apple-touch-icon.png">');
  });

  test('va en la marca, que desaparece, y el resto del documento queda igual', () => {
    const html = render(req('/galaxy/'));
    expect(html).not.toContain(SHELL_MARKER);
    expect(html.startsWith('<!doctype html>\n<html lang="es">\n  <head>\n    <meta charset="utf-8" />')).toBe(true);
    expect(html).toContain('<script type="module" crossorigin src="/galaxy/assets/index-abc.js"></script>\n  </head>\n  <body><div id="root"></div></body>\n</html>');
    expect(html.indexOf('<meta name="robots"')).toBeLessThan(html.indexOf('<script type="module"'));
  });

  test('sin la marca (si el compilador se la comiera) va antes de </head>', () => {
    const html = render(req('/galaxy/escaner'), CANONICAL, TEMPLATE.replace(SHELL_MARKER, ''));
    expect(titleOf(html)).toEqual(['Escáner profundo | Galaxy Survivor']);
    expect(html.indexOf('<meta name="robots"')).toBeLessThan(html.indexOf('</head>'));
    expect(html.indexOf('<meta name="robots"')).toBeGreaterThan(html.indexOf('<head>'));
  });

  test('sin marca ni </head> va donde estaba el título, después del doctype', () => {
    const html = render(req('/galaxy/entrar'), CANONICAL, '<!doctype html><title>Galaxy Survivor</title><div id="root"></div>');
    expect(html.startsWith('<!doctype html><title>Entrar | Galaxy Survivor</title>')).toBe(true);
    expect(html.endsWith('\n<div id="root"></div>')).toBe(true);
  });

  test('la plantilla de apps/web lleva la marca una vez', () => {
    const source = readFileSync(join(process.cwd(), 'apps/web/index.html'), 'utf8');
    expect(source.split(SHELL_MARKER)).toHaveLength(2);
    expect(source).toContain('<title>Galaxy Survivor</title>');
  });

  test('las URL de las tarjetas son absolutas en el origen canónico, con la invitación', () => {
    const html = render(req('/galaxy/crear-cuenta?ref=ABCD-12', 'pre.elclub.party'));
    expect(meta(html, 'property', 'og:url')).toBe('https://galaxysurvivor.es/galaxy/crear-cuenta?ref=ABCD-12');
    expect(meta(html, 'property', 'og:image')).toBe('https://galaxysurvivor.es/og/og-es-v1.jpg');
    expect(meta(html, 'name', 'twitter:image')).toBe('https://galaxysurvivor.es/og/og-es-v1.jpg');
  });

  test('sin origen canónico usan el de la petición', () => {
    const html = render(req('/galaxy/entrar', 'localhost:8090', 'http'), null);
    expect(meta(html, 'property', 'og:url')).toBe('http://localhost:8090/galaxy/entrar');
    expect(meta(html, 'property', 'og:image')).toBe('http://localhost:8090/og/og-es-v1.jpg');
  });

  test('una ruta que saldría del origen o un Host raro nunca llevan a otro sitio', () => {
    expect(meta(render(req('//evil.example/x')), 'property', 'og:url')).toBe('https://galaxysurvivor.es/galaxy/');
    const odd = render(req('/galaxy/', 'evil.example"><script>x</script>', 'http'), null);
    expect(odd).not.toContain('<script>x');
    expect(meta(odd, 'property', 'og:url')).toBe('http://localhost/galaxy/');
  });
});

describe('el manifest', () => {
  const MANIFEST = '<link rel="manifest" href="/galaxy/manifest.webmanifest">';

  test('solo en el host canónico', () => {
    expect(render(req('/galaxy/'))).toContain(MANIFEST);
    expect(render(req('/galaxy/', 'GalaxySurvivor.es'))).toContain(MANIFEST);
    expect(render(req('/galaxy/', 'pre.elclub.party'))).not.toContain(MANIFEST);
    expect(render(req('/galaxy/', 'www.galaxysurvivor.es'))).not.toContain(MANIFEST);
  });

  test('sin origen canónico (dev y e2e) siempre', () => {
    expect(render(req('/galaxy/', 'localhost:8090', 'http'), null)).toContain(MANIFEST);
  });

  test('un canónico con puerto exige el mismo puerto', () => {
    expect(render(req('/galaxy/', 'localhost:8090', 'http'), 'http://localhost:8090')).toContain(MANIFEST);
    expect(render(req('/galaxy/', 'localhost:8091', 'http'), 'http://localhost:8090')).not.toContain(MANIFEST);
  });
});

test('todo valor que viene de la petición va escapado', () => {
  const html = render(req('/galaxy/entrar?ref="><script>alert(1)</script>&x=\'y\''));
  expect(html).not.toContain('<script>alert');
  expect(html).not.toMatch(/content="[^"]*"[^ >/]/);
  expect(meta(html, 'property', 'og:url')).toContain('&amp;x=');
});
