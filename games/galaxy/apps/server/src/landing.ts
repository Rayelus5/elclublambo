import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { LegalIdentity } from './env';

// The landing of galaxysurvivor.es at the site root (plan «galaxysurvivor.es», PR 4): the pages, text and public files
// the landing build lists in routes.json (apps/landing/scripts/finish.mjs), read once at start-up, and its hashed
// assets under /static/ (cached for a year; @fastify/static answers Range requests, which Safari needs for the clips).
// The legal pages get the holder's data from galaxy.env (never in the public repository); without the build, nothing
// is served and the site root answers the JSON 404 of always.

const LONG_CACHE = 'public, max-age=31536000, immutable';
const TOKENS = ['holder', 'nif', 'address'] as const;
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** `s` safe inside HTML text and quoted attributes. */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

/** The legal pages with the holder's data: each `<!--legal:x-->` filled (escaped), or the whole line dropped. */
export function fillLegal(html: string, legal: LegalIdentity): string {
  let out = html;
  for (const t of TOKENS) {
    const value = legal[t];
    out = value
      ? out.replaceAll(`<!--legal:${t}-->`, esc(value))
      : out.replace(new RegExp(`<li data-legal-line="${t}">[^<]*<!--legal:${t}--></li>`, 'g'), '');
  }
  return out;
}

/** The old address's notice with the new address in each {{href}}, escaped (a function replacer: `$` is just text). */
export function fillMoved(html: string, href: string): string {
  const value = esc(href);
  return html.replaceAll('{{href}}', () => value);
}

/** The holder's data the legal pages lack (logged once at start-up: legal_identity_missing). */
export function missingLegal(legal: LegalIdentity): (typeof TOKENS)[number][] {
  return TOKENS.filter((t) => !legal[t]);
}

interface Entry {
  route: string | null;
  file: string;
  type: string;
  /** 'moved': the old address's notice, filled per request (apps/server/src/security/host.ts). */
  role?: 'moved';
}
interface Served {
  body: Buffer;
  type: string;
  etag: string;
}

export interface Landing {
  /** The answer for a GET/HEAD that matched nothing on the site (outside /galaxy): a clean-path redirect or the 404. */
  notFound(req: FastifyRequest, reply: FastifyReply): FastifyReply;
  /** The old address's notice with its button to `location`, or null when the build has none. */
  moved(location: string): string | null;
}

function served(body: Buffer, type: string): Served {
  return { body, type, etag: `"${createHash('sha1').update(body).digest('base64url').slice(0, 27)}"` };
}

function send(req: FastifyRequest, reply: FastifyReply, s: Served, status = 200): FastifyReply {
  reply.header('cache-control', 'no-cache').header('etag', s.etag).type(s.type);
  if (status === 200 && req.headers['if-none-match'] === s.etag) return reply.code(304).send();
  return reply.code(status).send(s.body);
}

export async function registerLanding(app: FastifyInstance, dist: string, legal: LegalIdentity): Promise<Landing | null> {
  const manifest = join(dist, 'routes.json');
  if (!existsSync(manifest)) return null;
  const { files } = JSON.parse(readFileSync(manifest, 'utf8')) as { files: Entry[] };
  const missing = missingLegal(legal);
  if (missing.length) app.log.warn({ missing }, 'legal_identity_missing');

  let notFoundPage: Served | null = null;
  let movedTemplate: string | null = null;
  // Page routes by their clean path, to send /x.html and /x/ there.
  const pages = new Set<string>();
  for (const f of files) {
    const raw = readFileSync(join(dist, f.file));
    if (f.role === 'moved') {
      movedTemplate = raw.toString('utf8');
      continue;
    }
    const isHtml = f.type.startsWith('text/html');
    const s = served(isHtml ? Buffer.from(fillLegal(raw.toString('utf8'), legal)) : raw, f.type);
    if (f.route === null) {
      notFoundPage = s;
      continue;
    }
    if (isHtml) pages.add(f.route);
    app.get(f.route, (req, reply) => send(req, reply, s));
  }

  if (existsSync(join(dist, 'static'))) {
    await app.register(fastifyStatic, {
      root: join(dist, 'static'),
      prefix: '/static/',
      wildcard: false,
      index: false,
      redirect: false,
      cacheControl: false,
      decorateReply: false,
      setHeaders: (reply: FastifyReply) => {
        reply.header('cache-control', LONG_CACHE);
      },
    });
  }

  const page404 = notFoundPage;
  const moved = movedTemplate;
  return {
    moved: (location) => (moved ? fillMoved(moved, location) : null),
    notFound(req, reply) {
      const [path = '/', query] = req.url.split('?');
      // /index.html → /, /x.html → /x, /x/ → /x, when /x is a page.
      const clean = path === '/index.html' ? '/' : path.endsWith('.html') ? path.slice(0, -5) : path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : null;
      if (clean !== null && pages.has(clean)) return reply.redirect(query === undefined ? clean : `${clean}?${query}`, 301);
      if (!page404) return reply.code(404).send({ error: 'not_found' });
      return send(req, reply, page404, 404);
    },
  };
}
