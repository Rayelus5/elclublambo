import type { FastifyRequest } from 'fastify';
import { expect, test } from 'vitest';
import { clientIp } from '../../src/security/client-ip';

const fakeReq = (headers: Record<string, string>, remoteAddress?: string) =>
  ({ headers, socket: { remoteAddress } }) as unknown as FastifyRequest;

test('usa CF-Connecting-IP válida (v4 y v6)', () => {
  expect(clientIp(fakeReq({ 'cf-connecting-ip': '203.0.113.7' }, '10.0.0.2'), true)).toBe('203.0.113.7');
  expect(clientIp(fakeReq({ 'cf-connecting-ip': '2001:db8::1' }, '10.0.0.2'), true)).toBe('2001:db8::1');
});

test('cae al socket si falta, es basura o no se confía en Cloudflare', () => {
  expect(clientIp(fakeReq({}, '10.0.0.2'), true)).toBe('10.0.0.2');
  expect(clientIp(fakeReq({ 'cf-connecting-ip': 'no-ip' }, '10.0.0.2'), true)).toBe('10.0.0.2');
  expect(clientIp(fakeReq({ 'cf-connecting-ip': '203.0.113.7' }, '10.0.0.2'), false)).toBe('10.0.0.2');
});

test('sin cabecera ni socket → unknown', () => {
  expect(clientIp(fakeReq({}), true)).toBe('unknown');
});
