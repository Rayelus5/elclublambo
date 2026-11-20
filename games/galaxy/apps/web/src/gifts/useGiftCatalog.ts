import { useMemo } from 'react';
import { useConfigKeys } from '../api/config';
import { useLiveContent } from '../api/content';
import { giftCatalog, type GiftCatalog } from './words';

/** The panel's gift catalog (mail v2, P3): the live config keys and the live run content's probes. Null until read. */
export function useGiftCatalog(): { catalog: GiftCatalog | null; error: unknown } {
  const keys = useConfigKeys();
  const content = useLiveContent();
  const catalog = useMemo(() => (keys.data ? giftCatalog(keys.data, content.probes, new Date()) : null), [keys.data, content]);
  return { catalog, error: keys.error };
}
