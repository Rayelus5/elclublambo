import type { CollectionPage, Finish, GachaView, GalaxyDetail, GalaxySummary, PullRequest, PullResponse, Tier, Wallet } from '@galaxy/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ApiError, api } from './client';

// The economy as the client sees it (GDD §9, §8.5). The server decides everything; the client only shows what it
// answers. Every action carries an Idempotency-Key made once per player INTENT (this scan of 10 with signals, this
// galaxy disintegrated…): if the answer is lost (network error or 5xx) the same intent retried reuses it, so the
// server replays the first result instead of charging again. A real answer (success or 4xx) ends the intent.
export const GACHA_KEY = ['gacha'] as const;
export const COLLECTION_KEY = ['galaxies'] as const;
const GALAXY_KEY = 'galaxy';

/** Banners, costs, the daily free pull and the wallet. The first read of a new account also gives the welcome. */
export function useGacha() {
  return useQuery({ queryKey: GACHA_KEY, queryFn: () => api<GachaView>('/gacha'), staleTime: 30_000 });
}

export interface CollectionQuery {
  tier?: Tier;
  type?: string;
  palette?: string;
  finish?: Finish;
  sort?: 'new' | 'rarity';
  cursor?: string;
  limit?: number;
}

/** `/galaxies?…` with the parameters in a fixed order, so equal queries are equal URLs. */
export function collectionPath(q: CollectionQuery): string {
  const params = new URLSearchParams();
  for (const key of ['tier', 'type', 'palette', 'finish', 'sort', 'limit', 'cursor'] as const) {
    const value = q[key];
    if (value !== undefined) params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `/galaxies?${search}` : '/galaxies';
}

export function useCollection(q: CollectionQuery) {
  return useQuery({ queryKey: [...COLLECTION_KEY, q], queryFn: () => api<CollectionPage>(collectionPath(q)), staleTime: 30_000 });
}

/** The collection grid: pages of `limit`, following the server's cursor. */
export function useCollectionPages(q: Omit<CollectionQuery, 'cursor'>) {
  return useInfiniteQuery({
    queryKey: [...COLLECTION_KEY, 'pages', q],
    queryFn: ({ pageParam }) => api<CollectionPage>(collectionPath({ ...q, ...(pageParam ? { cursor: pageParam } : {}) })),
    initialPageParam: '',
    getNextPageParam: (last) => last.next,
  });
}

export function useGalaxyDetail(id: string | undefined) {
  return useQuery({
    queryKey: [GALAXY_KEY, id],
    queryFn: () => api<GalaxyDetail>(`/galaxies/${id}`),
    enabled: !!id,
  });
}

const intents = new Map<string, string>();

function keyFor(intent: string): Record<string, string> {
  let key = intents.get(intent);
  if (!key) {
    key = crypto.randomUUID();
    intents.set(intent, key);
  }
  return { 'idempotency-key': key };
}

/** The intent ends with a real answer; a lost one (no response, 5xx) keeps its key for the retry. */
function endIntent(intent: string, error: unknown): void {
  const lost = error instanceof ApiError ? error.status === 0 || error.status >= 500 : !!error;
  if (!lost) intents.delete(intent);
}

/** After an action: the new wallet everywhere, and every list of galaxies read again. */
function settle(qc: QueryClient, wallet: Wallet): void {
  qc.setQueryData<GachaView>(GACHA_KEY, (old) => (old ? { ...old, wallet } : old));
  void qc.invalidateQueries({ queryKey: COLLECTION_KEY });
}

/** After a failure the server may still have done it: read balances and galaxies again. */
function refresh(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: GACHA_KEY });
  void qc.invalidateQueries({ queryKey: COLLECTION_KEY });
}

export function useDisintegrate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ dust: number; wallet: Wallet }>(`/galaxies/${id}/disintegrate`, { method: 'POST', headers: keyFor(`disintegrate:${id}`) }),
    onSuccess: (res, id) => {
      settle(qc, res.wallet);
      qc.removeQueries({ queryKey: [GALAXY_KEY, id] });
    },
    onError: () => refresh(qc),
    onSettled: (_res, error, id) => endIntent(`disintegrate:${id}`, error),
  });
}

const pullIntent = (req: PullRequest) => `pull:${req.banner}:${req.count}:${req.pay}`;
const fuseIntent = (ids: string[]) => `fuse:${[...ids].sort().join(',')}`;

/** A scan: the server rolls, charges and stores; the answer carries the galaxies, the wallet and the new odds. */
export function usePull() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: PullRequest) => api<PullResponse>('/gacha/pull', { method: 'POST', body: req, headers: keyFor(pullIntent(req)) }),
    onSuccess: (res) => {
      qc.setQueryData<GachaView>(GACHA_KEY, { ...res.view, wallet: res.wallet });
      void qc.invalidateQueries({ queryKey: COLLECTION_KEY });
    },
    onError: () => refresh(qc),
    onSettled: (_res, error, req) => endIntent(pullIntent(req), error),
  });
}

export function useFuse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      api<{ galaxy: GalaxySummary; wallet: Wallet }>('/galaxies/fuse', { method: 'POST', body: { ids }, headers: keyFor(fuseIntent(ids)) }),
    onSuccess: (res) => settle(qc, res.wallet),
    onError: () => refresh(qc),
    onSettled: (_res, error, ids) => endIntent(fuseIntent(ids), error),
  });
}
