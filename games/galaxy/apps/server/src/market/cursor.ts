import type { MarketSort } from '@galaxy/shared';
import { HttpError } from '../errors';

// Where a page of the market goes on from (the owner, 2026-11-14: «profesional para 100.000 anuncios»): the last
// listing's values in the page's order, as an opaque text (base64url of a small JSON). A page read with it never
// repeats nor skips a listing, whatever is listed meanwhile, and the database reads only what it shows. A cursor made
// for another order, or one that is not ours, is a bad request.

export type CursorValue = string | number;

export function encodeCursor(sort: MarketSort | 'board', values: readonly CursorValue[]): string {
  return Buffer.from(JSON.stringify({ s: sort, v: values }), 'utf8').toString('base64url');
}

export function decodeCursor(sort: MarketSort | 'board', cursor: string, length: number): CursorValue[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_input');
  }
  const p = parsed as { s?: unknown; v?: unknown };
  const ok =
    p &&
    typeof p === 'object' &&
    p.s === sort &&
    Array.isArray(p.v) &&
    p.v.length === length &&
    p.v.every((x) => (typeof x === 'string' && x.length <= 64) || (typeof x === 'number' && Number.isFinite(x)));
  if (!ok) throw new HttpError(400, 'invalid_input');
  return p.v as CursorValue[];
}
