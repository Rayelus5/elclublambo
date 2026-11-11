import type { Wallet } from '@galaxy/shared';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

// One wallet, several caches: the hub's (['gacha']) is what most wallet bars read, but the station, the Laboratorio
// and the Hangar views carry their own copy. After any action the new wallet goes into every one that is loaded, so no
// bar lags behind until its next refetch. (The keys are spelled here to keep this file free of import cycles; the
// wallet bar's test checks they are the exported ones.)

const HOLDERS: readonly QueryKey[] = [['gacha'], ['station'], ['lab'], ['hangar']];

export function syncWallet(qc: QueryClient, wallet: Wallet): void {
  for (const key of HOLDERS) {
    qc.setQueryData<{ wallet?: Wallet }>(key, (old) => (old && typeof old === 'object' && 'wallet' in old ? { ...old, wallet } : old));
  }
}
