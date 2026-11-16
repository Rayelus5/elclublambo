import { type MyMailbox, parseConfig } from '@galaxy/shared';
import { useMemo } from 'react';
import { useLiveContent } from '../api/content';
import { useCosmeticsView } from '../api/cosmetics';
import type { GiftCatalog } from './words';

type View = Pick<GiftCatalog, 'events' | 'season' | 'cosmetics' | 'probes'>;
const DEFAULT_COSMETICS = parseConfig('cosmetics', {});
const SEASON_CURRENCY = parseConfig('seasonRoute', {}).currency.name;

/**
 * What a player's mailbox knows to name and draw gifts (mail v2): the pieces' catalog, the live probes, and the names
 * the mailbox brings (P6: the events' and the season's currency; their defaults before it arrives).
 */
export function usePlayerGiftView(names?: MyMailbox['names']): View {
  const cosmetics = useCosmeticsView().data?.catalog ?? DEFAULT_COSMETICS;
  const content = useLiveContent();
  return useMemo(
    () => ({
      cosmetics,
      probes: content.probes.map((p) => ({ id: p.id, name: p.name, sprite: p.sprite })),
      events: (names?.events ?? []).map((e) => ({ ...e, endsAt: '' })),
      season: { id: '', open: true, currencyName: names?.seasonCurrency ?? SEASON_CURRENCY, endsAt: '' },
    }),
    [cosmetics, content, names],
  );
}
