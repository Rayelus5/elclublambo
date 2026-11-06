import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';

/**
 * Client IP for rate limits and session records. Behind the Cloudflare tunnel the socket peer is cloudflared, so the
 * real address comes in CF-Connecting-IP; anything that is not a valid IP falls back to the socket peer.
 */
export function clientIp(req: FastifyRequest, trustCf: boolean): string {
  const cf = req.headers['cf-connecting-ip'];
  if (trustCf && typeof cf === 'string' && isIP(cf) !== 0) return cf;
  return req.socket?.remoteAddress ?? 'unknown';
}
