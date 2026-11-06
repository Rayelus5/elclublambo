import { ENGINE_VERSION, type BrailleRender, type Traits } from '@galaxy/engine';

// Galaxy renders cached in memory (LRU) and in IndexedDB, keyed by the stored shape (`r1`) and the engine version: a
// new visual version or a new stored shape never reuses an old render. IndexedDB is best effort — private windows, blocked storage or jsdom fall back to memory only.
const DB_NAME = 'galaxy-cache';
const STORE = 'renders';
const MEMORY_ENTRIES = 12;
const DISK_ENTRIES = 48; // a 192-column render weighs ~2.4 MB
const OPEN_TIMEOUT_MS = 1500; // some WebKit builds never answer indexedDB.open
/** The shape of a stored render: bump it whenever what is stored changes. */
const SCHEMA = 'r1';

export function galaxyKey(seed: bigint, columns: number, fixed?: Partial<Traits>, version: string = ENGINE_VERSION): string {
  const pinned = Object.entries(fixed ?? {})
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  return `${SCHEMA}:${version}:${seed}:${columns}:${pinned || '-'}`;
}

type Stored = { key: string; render: BrailleRender; at: number };

const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

export class GalaxyCache {
  private readonly memory = new Map<string, BrailleRender>();
  private readonly capacity: number;
  private db: Promise<IDBDatabase | null>;

  constructor(opts: { capacity?: number; indexedDB?: IDBFactory | null; openTimeoutMs?: number } = {}) {
    this.capacity = opts.capacity ?? MEMORY_ENTRIES;
    const factory = opts.indexedDB === undefined ? globalThis.indexedDB : opts.indexedDB;
    this.db = factory ? this.open(factory, opts.openTimeoutMs ?? OPEN_TIMEOUT_MS) : Promise.resolve(null);
  }

  /** The database, or null if it fails or does not answer in time (then the cache is memory only). */
  private open(factory: IDBFactory, timeoutMs: number): Promise<IDBDatabase | null> {
    try {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('at', 'at');
      };
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
      return Promise.race([request(req).catch(() => null), timeout]);
    } catch {
      return Promise.resolve(null);
    }
  }

  private remember(key: string, render: BrailleRender): void {
    this.memory.delete(key);
    this.memory.set(key, render);
    while (this.memory.size > this.capacity) this.memory.delete(this.memory.keys().next().value!);
  }

  async get(key: string): Promise<BrailleRender | undefined> {
    const hit = this.memory.get(key);
    if (hit) {
      this.remember(key, hit);
      return hit;
    }
    const db = await this.db;
    if (!db) return undefined;
    try {
      const stored = (await request(db.transaction(STORE).objectStore(STORE).get(key))) as Stored | undefined;
      if (!stored) return undefined;
      this.remember(key, stored.render);
      return stored.render;
    } catch {
      return undefined;
    }
  }

  async put(key: string, render: BrailleRender): Promise<void> {
    this.remember(key, render);
    const db = await this.db;
    if (!db) return;
    try {
      const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
      await request(store.put({ key, render, at: Date.now() } satisfies Stored));
      const keys = await request(store.index('at').getAllKeys());
      for (const old of keys.slice(0, Math.max(0, keys.length - DISK_ENTRIES))) store.delete(old);
    } catch {
      // Quota or a closed database: the memory copy is enough.
    }
  }
}
