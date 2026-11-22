import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

// The open beta's reset (ops/reset-beta.sql) empties every player table with one TRUNCATE. Postgres refuses to truncate
// a table that another table points at unless that one is in the same TRUNCATE: every table added since must join the
// list (the tournaments, 2026-11-22 review). Read from the migrations, never run here.

const root = fileURLToPath(new URL('../../../../../../', import.meta.url));
const migrations = readdirSync(`${root}supabase/migrations`).filter((f) => /_galaxy_/.test(f)).sort();
const sql = migrations.map((f) => readFileSync(`${root}supabase/migrations/${f}`, 'utf8')).join('\n');
const reset = readFileSync(`${root}games/galaxy/ops/reset-beta.sql`, 'utf8');

/** Who points at whom: table → tables it references (from create table blocks and added columns). */
function references(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (from: string, to: string) => {
    if (from !== to) (out.get(from) ?? out.set(from, new Set()).get(from)!).add(to);
  };
  for (const m of sql.matchAll(/create table galaxy\.(\w+)\s*\(([\s\S]*?)\n\);/g)) for (const r of m[2]!.matchAll(/references galaxy\.(\w+)/g)) add(m[1]!, r[1]!);
  for (const m of sql.matchAll(/alter table galaxy\.(\w+)\s+([^;]*?);/g)) for (const r of m[2]!.matchAll(/references galaxy\.(\w+)/g)) add(m[1]!, r[1]!);
  return out;
}

test('cada tabla que apunta a una tabla vaciada se vacía en el mismo TRUNCATE', () => {
  const list = reset.match(/truncate table([\s\S]*?)restart identity/)![1]!;
  const truncated = new Set([...list.matchAll(/galaxy\.(\w+)/g)].map((m) => m[1]!));
  const missing: string[] = [];
  // The accounts go with a DELETE: their banner's key is dropped for the reset and put back after it.
  const dropped = new Set(reset.includes('drop constraint accounts_banner_fkey') && reset.includes('add constraint accounts_banner_fkey') ? ['accounts → galaxies'] : []);
  for (const [from, tos] of references()) {
    for (const to of tos) if (truncated.has(to) && !truncated.has(from) && !dropped.has(`${from} → ${to}`)) missing.push(`${from} → ${to}`);
  }
  expect(missing).toEqual([]);
  for (const t of ['tournaments', 'tournament_entries', 'tournament_checks', 'tournament_cash', 'popup_campaigns', 'popup_views', 'popup_responses', 'popup_answers']) expect(truncated, t).toContain(t);
});
