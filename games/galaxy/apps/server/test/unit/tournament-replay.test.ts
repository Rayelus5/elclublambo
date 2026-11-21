import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, test } from 'vitest';
import { verifyRun } from '../../src/tournaments/replay';
import { inlineReplayer, type Replayer, workerReplayer } from '../../src/tournaments/replayer';
import { playedRun } from '../replay-fixture';

// The review's replay (plan «temporadas como fichas», part 5; GDD §13.3): a prize place's solo run played again on the
// server from what it kept, its end against what the client sent (the hash, ticks, kills, depth, level, Cores and the
// outcome), and what cannot be checked said as such so an admin decides. In production it runs in a worker thread, one
// at a time, so the game's event loop never waits for it.

const run = playedRun(900);
const rowsOf = (v: ReturnType<typeof verifyRun>) => ('rows' in v.detail ? v.detail.rows : []);

describe('la comprobación de una partida', () => {
  test('una partida limpia coincide', () => {
    const v = verifyRun(run);
    expect(v.status).toBe('ok');
    expect(rowsOf(v).length).toBeGreaterThan(0);
    expect(rowsOf(v).every((r) => r.same)).toBe(true);
  });

  test('una cifra inflada no coincide, aunque la huella sí', () => {
    const v = verifyRun({ ...run, run: { ...run.run, claimed: { ...run.run.claimed!, kills: run.run.claimed!.kills + 5 } } });
    expect(v.status).toBe('mismatch');
    expect(rowsOf(v).filter((r) => !r.same).map((r) => r.key)).toEqual(['kills']);
    expect(verifyRun({ ...run, run: { ...run.run, outcome: 'extracted' } }).status).toBe('mismatch');
  });

  test('lo que no se puede comprobar lo dice y espera a un admin', () => {
    expect(verifyRun({ ...run, inputs: null })).toEqual({ status: 'unverifiable', detail: { reason: 'inputs_missing' } });
    expect(verifyRun({ ...run, inputs: 'no-es-un-registro' })).toEqual({ status: 'unverifiable', detail: { reason: 'inputs_unreadable' } });
    expect(verifyRun({ ...run, run: { ...run.run, simVersion: '0.0.1' } })).toEqual({ status: 'unverifiable', detail: { reason: 'sim_version' } });
    expect(verifyRun({ ...run, contentFallback: true })).toEqual({ status: 'unverifiable', detail: { reason: 'content_unreadable' } });
  });
});

describe('quien repite las partidas', () => {
  const dir = mkdtempSync(join(tmpdir(), 'galaxy-replay-'));
  const made: Replayer[] = [];
  afterAll(async () => {
    for (const r of made) await r.close();
  });
  /** A worker that answers each job after `ms` (or never, with ms < 0), recording how many run at once. */
  const fakeWorker = (name: string, ms: number) => {
    const file = join(dir, `${name}.mjs`);
    writeFileSync(
      file,
      `import { parentPort } from 'node:worker_threads';
let busy = 0;
parentPort.on('message', (m) => {
  busy++;
  const at = busy;
  if (${ms} < 0) return;
  setTimeout(() => { busy--; parentPort.postMessage({ id: m.id, verdict: { status: 'ok', detail: { rows: [], busy: at, run: m.data.run.id } } }); }, ${ms});
});`,
    );
    return pathToFileURL(file);
  };

  test('en el proceso, para las pruebas', async () => {
    const r = inlineReplayer();
    made.push(r);
    expect((await r.verify(run)).status).toBe('ok');
  });

  test('en un hilo aparte, de una en una y en orden', async () => {
    const r = workerReplayer({ url: fakeWorker('slow', 30) });
    made.push(r);
    const ids = ['a', 'b', 'c'];
    const out = await Promise.all(ids.map((id) => r.verify({ ...run, run: { ...run.run, id } })));
    expect(out.map((v) => (v.detail as { run?: string }).run)).toEqual(ids);
    expect(out.every((v) => (v.detail as { busy?: number }).busy === 1)).toBe(true);
  });

  test('una que no acaba a tiempo es un error y el hilo se cambia por otro', async () => {
    const r = workerReplayer({ url: fakeWorker('stuck', -1), timeoutMs: 100 });
    made.push(r);
    expect(await r.verify(run)).toEqual({ status: 'error', detail: { reason: 'timeout' } });
    expect(await r.verify(run)).toEqual({ status: 'error', detail: { reason: 'timeout' } });
  });
});
