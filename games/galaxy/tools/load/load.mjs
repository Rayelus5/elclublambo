#!/usr/bin/env node
/* global process, URL, fetch, performance, console */
// Galaxy Survivor load test (GDD §19 M8): many virtual players reading what the game reads most, against one server,
// with the latency of each route (p50, p95, p99), its errors and the requests per second. No dependencies: Node 22's
// fetch. Registering is limited per IP (`auth.registerPerIpHour`, 5 by default), so the sessions are few and shared;
// the load is in the reads.
//
//   node tools/load/load.mjs --base https://pre.elclub.party/galaxy --users 3 --concurrency 40 --seconds 60
//   LOAD_USERS="usuario:clave,otro:clave" node tools/load/load.mjs --base http://localhost:8090/galaxy
//
// It creates `e2e_load_*` accounts when LOAD_USERS is not given. Run it only against a server you may load.

import { randomBytes } from 'node:crypto';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const BASE = (args.base ?? 'http://localhost:8090/galaxy').replace(/\/$/, '');
const ORIGIN = new URL(BASE).origin;
const USERS = Number(args.users ?? 3);
const CONCURRENCY = Number(args.concurrency ?? 20);
const SECONDS = Number(args.seconds ?? 30);
const READS = ['/api/auth/me', '/api/gacha', '/api/missions', '/api/season', '/api/leaderboard?tab=general', '/api/boosts', '/api/onboarding', '/api/catalog', '/api/hangar'];

function cookieOf(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(';')[0]).join('; ');
}

async function session(username, password, create) {
  const headers = { 'content-type': 'application/json', origin: ORIGIN };
  const res = await fetch(`${BASE}/api/auth/${create ? 'register' : 'login'}`, { method: 'POST', headers, body: JSON.stringify({ username, password }) });
  if (!res.ok) throw new Error(`${create ? 'register' : 'login'} ${username}: ${res.status} ${await res.text()}`);
  const cookie = cookieOf(res);
  if (create) {
    // The probe test first, as every new player (answers: always the first).
    await fetch(`${BASE}/api/probe-test`, { method: 'POST', headers: { ...headers, cookie }, body: JSON.stringify({ answers: [0, 0, 0, 0, 0] }) });
  }
  return cookie;
}

async function sessions() {
  if (process.env.LOAD_USERS) {
    return Promise.all(process.env.LOAD_USERS.split(',').map((pair) => { const [u, p] = pair.split(':'); return session(u, p, false); }));
  }
  const out = [];
  for (let i = 0; i < USERS; i++) out.push(await session(`e2e_load_${randomBytes(3).toString('hex')}`, `carga-${randomBytes(8).toString('hex')}`, true));
  return out;
}

const stats = new Map();
function record(route, ms, ok) {
  const s = stats.get(route) ?? { times: [], errors: 0 };
  s.times.push(ms);
  if (!ok) s.errors++;
  stats.set(route, s);
}
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;

async function worker(cookies, until) {
  while (Date.now() < until) {
    const route = READS[Math.floor(Math.random() * READS.length)];
    const cookie = cookies[Math.floor(Math.random() * cookies.length)];
    const t0 = performance.now();
    let ok = false;
    try {
      const res = await fetch(`${BASE}${route}`, { headers: { cookie } });
      await res.arrayBuffer();
      ok = res.ok;
    } catch {
      ok = false;
    }
    record(route.split('?')[0], performance.now() - t0, ok);
  }
}

const cookies = await sessions();
console.log(`${cookies.length} sesiones, ${CONCURRENCY} a la vez durante ${SECONDS} s contra ${BASE}`);
const start = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(cookies, start + SECONDS * 1000)));
const elapsed = (Date.now() - start) / 1000;

let total = 0;
let errors = 0;
console.log('\nruta                         peticiones  errores    p50     p95     p99 (ms)');
for (const [route, s] of [...stats].sort()) {
  const sorted = [...s.times].sort((a, b) => a - b);
  total += sorted.length;
  errors += s.errors;
  console.log(`${route.padEnd(28)} ${String(sorted.length).padStart(10)} ${String(s.errors).padStart(8)} ${pct(sorted, 50).toFixed(0).padStart(6)} ${pct(sorted, 95).toFixed(0).padStart(7)} ${pct(sorted, 99).toFixed(0).padStart(7)}`);
}
console.log(`\n${total} peticiones en ${elapsed.toFixed(1)} s: ${(total / elapsed).toFixed(1)} por segundo, ${errors} errores (${((errors / Math.max(1, total)) * 100).toFixed(2)} %)`);
process.exit(errors / Math.max(1, total) > 0.01 ? 1 : 0);
