import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const LONG_CACHE = 'public, max-age=31536000, immutable';

/** True when this request should get the SPA shell: a GET/HEAD under /galaxy/ that is neither API nor an asset file. */
export function wantsSpaShell(req: FastifyRequest): boolean {
  const path = req.url.split('?')[0] ?? '';
  return (
    (req.method === 'GET' || req.method === 'HEAD') &&
    path.startsWith('/galaxy/') &&
    !path.startsWith('/galaxy/api/') &&
    !path.startsWith('/galaxy/assets/')
  );
}

export function sendSpaShell(reply: FastifyReply): FastifyReply {
  return reply.header('cache-control', 'no-cache').type('text/html; charset=utf-8').sendFile('index.html');
}

/**
 * Serves the Vite build under /galaxy/ (GDD §18.1): hashed assets cached for a year, everything else revalidated.
 * Unknown paths fall back to index.html through the app's not-found handler (see wantsSpaShell).
 */
export async function registerStatic(app: FastifyInstance, webDist: string): Promise<boolean> {
  if (!existsSync(join(webDist, 'index.html'))) return false;
  await app.register(fastifyStatic, {
    root: webDist,
    prefix: '/galaxy/',
    wildcard: false,
    index: ['index.html'],
    redirect: false,
    cacheControl: false,
    // @fastify/static 10 calls setHeaders(reply, path, stat) with the Fastify reply, not the Node response.
    setHeaders: (reply: FastifyReply, filePath: string) => {
      reply.header('cache-control', /[\\/]assets[\\/]/.test(filePath) ? LONG_CACHE : 'no-cache');
    },
  });
  app.get('/galaxy', (_req, reply) => reply.redirect('/galaxy/', 308));
  return true;
}
