import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import { titleFor } from '@galaxy/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { esc } from './landing';

const LONG_CACHE = 'public, max-age=31536000, immutable';

/** Where the shell's head goes in apps/web/index.html (Vite keeps HTML comments in the build). */
export const SHELL_MARKER = '<!--gs:head-->';

// What every game page says in a link preview (galaxysurvivor.es plan, PR 2): the landing's own words, nothing an admin
// can change. Account creation (where invite links lead) gets its own.
const DESCRIPTION = 'Pilota tu sonda contra la Estática, sobrevive a hordas y Núcleos, rescata galaxias únicas y juega en grupo hasta cuatro. Gratis en el navegador';
const SIGNUP_DESCRIPTION = 'Crea tu cuenta gratis y pilota tu sonda contra la Estática. Rescata galaxias únicas y juega solo o en grupo hasta cuatro, en el navegador de tu ordenador';
/** The landing's social card (apps/landing/public/og), served at the site root. */
const OG_IMAGE = '/og/og-es-v1.jpg';
const OG_IMAGE_ALT = 'Galaxy Survivor: Sobrevive a la Estática, con una galaxia legendaria y una sonda';
const THEME = '#070a1c';
/** A Host header we would put in a URL: a name or an IPv6 literal, with an optional port. Anything else is localhost. */
const SAFE_HOST = /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/;

/** What the shell needs from a request (a FastifyRequest fits): its raw target, its Host and its scheme. */
export interface ShellRequest {
  url: string;
  host: string | undefined;
  protocol: string;
}

export interface ShellOptions {
  /** dist/index.html as built, read once at start-up. */
  template: string;
  /** The game's own origin (`https://galaxysurvivor.es`), or null in dev and e2e. */
  canonicalOrigin: string | null;
  /** The installable app (GALAXY_PWA): off, the manifest never goes out. On by default. */
  pwa?: boolean;
}

/** The same path and query on `origin`; a request target that would resolve anywhere else gets the game's home. */
function pageUrl(origin: string, rawUrl: string): string {
  if (rawUrl.startsWith('/') && !rawUrl.startsWith('//')) {
    try {
      const url = new URL(rawUrl, origin);
      if (url.origin === origin) return url.origin + url.pathname + url.search;
    } catch {
      // Not a URL: the home below.
    }
  }
  return `${origin}/galaxy/`;
}

/** The Host header, lowercase and without a final dot; null when it is not a plain host[:port]. */
function cleanHost(host: string | undefined): string | null {
  let h = (host ?? '').trim().toLowerCase();
  if (h.endsWith('.')) h = h.slice(0, -1);
  return SAFE_HOST.test(h) ? h : null;
}

/**
 * The game's shell for this request (galaxysurvivor.es plan, PR 2; GDD §18.1): the built index.html with its own head
 * at SHELL_MARKER (or before </head>), its title replaced by the screen's. The head carries the description, noindex
 * (only the landing and its legal pages are indexed: the game needs a session and a computer), the theme colour and
 * icons, and Open Graph and Twitter cards with absolute URLs on the canonical origin, so an invite link previews well.
 * The manifest only goes out on the canonical host (or with none configured), so an old host never offers to install,
 * and never with the app switched off (GALAXY_PWA=off).
 * Only meta and link tags: the CSP forbids inline scripts and styles. Every value is escaped.
 */
export function renderShell(req: ShellRequest, opts: ShellOptions): string {
  const host = cleanHost(req.host);
  const requestOrigin = `${req.protocol === 'https' ? 'https' : 'http'}://${host ?? 'localhost'}`;
  const origin = opts.canonicalOrigin ?? requestOrigin;
  const path = req.url.split(/[?#]/)[0] ?? '';
  const screen = path === '/galaxy' || path.startsWith('/galaxy/') ? path.slice('/galaxy'.length) : path;
  const title = titleFor(screen);
  const description = title === titleFor('/crear-cuenta') ? SIGNUP_DESCRIPTION : DESCRIPTION;
  const image = origin + OG_IMAGE;
  const manifest = opts.pwa !== false && (opts.canonicalOrigin === null || host === new URL(opts.canonicalOrigin).host);
  const head = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    '<meta name="robots" content="noindex">',
    `<meta name="theme-color" content="${THEME}">`,
    '<link rel="icon" href="/galaxy/icons/icon-192.png" sizes="192x192" type="image/png">',
    '<link rel="apple-touch-icon" href="/galaxy/icons/apple-touch-icon.png">',
    manifest ? '<link rel="manifest" href="/galaxy/manifest.webmanifest">' : '',
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Galaxy Survivor">',
    '<meta property="og:locale" content="es_ES">',
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(pageUrl(origin, req.url))}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${esc(OG_IMAGE_ALT)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${esc(image)}">`,
  ]
    .filter(Boolean)
    .join('\n    ');

  // The built title goes (the head has the screen's); the head takes the marker's place, or goes before </head>, or
  // where the title was.
  const builtTitle = /[ \t]*<title>[\s\S]*?<\/title>\r?\n?/.exec(opts.template);
  const html = builtTitle ? opts.template.slice(0, builtTitle.index) + opts.template.slice(builtTitle.index + builtTitle[0].length) : opts.template;
  if (html.includes(SHELL_MARKER)) return html.replace(SHELL_MARKER, () => head);
  const end = html.indexOf('</head>');
  const at = end >= 0 ? end : (builtTitle?.index ?? 0);
  return `${html.slice(0, at)}${head}\n${html.slice(at)}`;
}

/**
 * True when this request should get the SPA shell: a GET/HEAD under /galaxy/ that is neither API nor an asset, and a
 * route rather than a file (galaxysurvivor.es plan, PR 3): a missing manifest, worker or icon is a 404, never a page
 * the browser would take for it (nor a missing offline page the worker would keep). Web routes never have an
 * extension; /galaxy/index.html is the shell too.
 */
export function wantsSpaShell(req: FastifyRequest): boolean {
  const path = req.url.split('?')[0] ?? '';
  const last = path.slice(path.lastIndexOf('/') + 1);
  return (
    (req.method === 'GET' || req.method === 'HEAD') &&
    path.startsWith('/galaxy/') &&
    !path.startsWith('/galaxy/api/') &&
    !path.startsWith('/galaxy/assets/') &&
    (!/\.[^/.]+$/.test(last) || path === '/galaxy/index.html')
  );
}

/** Sends the game's shell for a request (registerStatic makes it once the build's index.html has been read). */
export type ShellSender = (req: FastifyRequest, reply: FastifyReply) => FastifyReply;

/**
 * The shell's sender: revalidated on every load and never indexed (X-Robots-Tag, besides the meta tag). A HEAD gets
 * the headers and the length only.
 */
export function shellSender(template: string, canonicalOrigin: string | null, pwa = true): ShellSender {
  return (req, reply) => {
    const html = renderShell(req, { template, canonicalOrigin, pwa });
    reply.header('cache-control', 'no-cache').header('x-robots-tag', 'noindex').type('text/html; charset=utf-8');
    if (req.method === 'HEAD') return reply.header('content-length', Buffer.byteLength(html)).send();
    return reply.send(html);
  };
}

/**
 * Serves the Vite build under /galaxy/ (GDD §18.1): hashed assets cached for a year, everything else revalidated.
 * index.html is never served as a file: /galaxy/, /galaxy/index.html and every web route fall through to the app's
 * not-found handler, which sends the rendered shell (see wantsSpaShell). Null without a build.
 */
export async function registerStatic(app: FastifyInstance, webDist: string, canonicalOrigin: string | null, pwa = true): Promise<ShellSender | null> {
  const index = join(webDist, 'index.html');
  if (!existsSync(index)) return null;
  const template = readFileSync(index, 'utf8');
  await app.register(fastifyStatic, {
    root: webDist,
    prefix: '/galaxy/',
    wildcard: false,
    index: false,
    globIgnore: ['index.html'],
    redirect: false,
    cacheControl: false,
    // @fastify/static 10 calls setHeaders(reply, path, stat) with the Fastify reply, not the Node response.
    setHeaders: (reply: FastifyReply, filePath: string) => {
      reply.header('cache-control', /[\\/]assets[\\/]/.test(filePath) ? LONG_CACHE : 'no-cache');
    },
  });
  app.get('/galaxy', (_req, reply) => reply.redirect('/galaxy/', 308));
  return shellSender(template, canonicalOrigin, pwa);
}
