import { parseConfig } from '@galaxy/shared';
import { useMemo } from 'react';
import { useLiveContent } from '../api/content';
import { useCosmeticsView } from '../api/cosmetics';
import type { GiftCatalog } from './words';

type View = Pick<GiftCatalog, 'events' | 'season' | 'cosmetics' | 'probes'>;
const DEFAULT_COSMETICS = parseConfig('cosmetics', {});
const SEASON_CURRENCY = parseConfig('seasonRoute', {}).currency.name;

/**
 * What a player's mailbox knows to name and draw gifts (mail v2): the pieces' catalog and the live probes. An event's
 * signals and the season's currency are named plainly here (the full names come with the mailbox v2, P6).
 */
export function usePlayerGiftView(): View {
  const cosmetics = useCosmeticsView().data?.catalog ?? DEFAULT_COSMETICS;
  const content = useLiveContent();
  return useMemo(
    () => ({
      cosmetics,
      probes: content.probes.map((p) => ({ id: p.id, name: p.name, sprite: p.sprite })),
      events: [],
      season: { id: '', open: true, currencyName: SEASON_CURRENCY, endsAt: '' },
    }),
    [cosmetics, content],
  );
}
