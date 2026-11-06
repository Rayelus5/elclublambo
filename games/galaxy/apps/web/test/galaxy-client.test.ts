import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// The engine Worker client must never hang: a Worker that cannot start or crashes rejects the job, and the next job
// gets a fresh Worker. Fake Workers stand in for the real one (jsdom has none); each test loads a fresh client.
type Job = { id: number };

class EchoWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  postMessage(job: Job) {
    setTimeout(() => this.onmessage?.({ data: { id: job.id, render: { text: `galaxy ${job.id}` } } }));
  }
  terminate() {}
}

class BlockedWorker {
  constructor() {
    throw new Error('Worker blocked by the browser');
  }
}

class CrashingWorker extends EchoWorker {
  override postMessage() {
    setTimeout(() => this.onerror?.({ message: 'failed to load the worker script' }));
  }
}

let client: typeof import('../src/galaxy/client');

beforeEach(async () => {
  vi.resetModules();
  client = await import('../src/galaxy/client');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('si el Worker no puede crearse, el trabajo se rechaza y el siguiente funciona', async () => {
  vi.stubGlobal('Worker', BlockedWorker);
  await expect(client.requestGalaxy(1n, 48)).rejects.toThrow(/blocked/);
  vi.stubGlobal('Worker', EchoWorker);
  await expect(client.requestGalaxy(2n, 48)).resolves.toMatchObject({ text: expect.stringMatching(/^galaxy/) });
});

test('si el Worker falla, se descarta y el siguiente trabajo usa uno nuevo', async () => {
  vi.stubGlobal('Worker', CrashingWorker);
  await expect(client.requestGalaxy(1n, 48)).rejects.toThrow(/worker script/);
  vi.stubGlobal('Worker', EchoWorker);
  await expect(client.requestGalaxy(2n, 48)).resolves.toMatchObject({ text: expect.stringMatching(/^galaxy/) });
});

test('al terminar un trabajo se quita su escucha de la señal de aborto', async () => {
  vi.stubGlobal('Worker', EchoWorker);
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  await client.requestGalaxy(3n, 48, undefined, controller.signal);
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
});
