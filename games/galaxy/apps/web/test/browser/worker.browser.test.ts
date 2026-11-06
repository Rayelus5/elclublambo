import { drawTraits, renderBraille, subRng, tokenSeed } from '@galaxy/engine';
import { expect, test } from 'vitest';
import { requestGalaxy } from '../../src/galaxy/client';

// The engine runs in one module Worker; results come back with transferable buffers.
test('el Worker devuelve el mismo braille que el hilo principal', async () => {
  for (const [index, fixed] of [
    [101, { phenomenon: 'none' }],
    [202, { galaxy_type: 'ring', phenomenon: 'comet' }],
  ] as const) {
    const seed = tokenSeed(20261104, index);
    const fromWorker = await requestGalaxy(seed, 48, fixed);
    const local = renderBraille(drawTraits(subRng(seed, 'traits'), fixed), seed, { columns: 48 });
    expect(fromWorker.text).toBe(local.text);
    expect(fromWorker.dotColor).toEqual(local.dotColor);
    expect(fromWorker.traits).toEqual(drawTraits(subRng(seed, 'traits'), fixed));
  }
});

test('un trabajo abortado no resuelve y no bloquea los siguientes', async () => {
  const controller = new AbortController();
  const aborted = requestGalaxy(tokenSeed(20261104, 303), 192, undefined, controller.signal);
  const queued = new AbortController();
  const neverSent = requestGalaxy(tokenSeed(20261104, 304), 192, undefined, queued.signal);
  controller.abort();
  queued.abort();
  await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
  await expect(neverSent).rejects.toMatchObject({ name: 'AbortError' });
  const next = await requestGalaxy(tokenSeed(20261104, 305), 48);
  expect(next.text.split('\n')).toHaveLength(24);
});

test('una señal ya abortada rechaza sin trabajar', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(requestGalaxy(1n, 48, undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
});
