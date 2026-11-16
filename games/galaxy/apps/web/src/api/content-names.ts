import type { Content } from '@galaxy/sim';
import { useMemo } from 'react';
import { useLiveContent } from './content';

// Names and sprites from the published content (the content editor, 2026-11-16): a sector, a probe or a weapon created
// or renamed from the admin panel reads right everywhere, not as the web was built.

export interface ContentNames {
  sectorName(id: string): string;
  probeName(id: string): string;
  probeSprite(id: string): string;
  weaponName(id: string): string;
}

export function contentNames(content: Content): ContentNames {
  return {
    sectorName: (id) => content.sectors.find((s) => s.id === id)?.name ?? id,
    probeName: (id) => content.probes.find((p) => p.id === id)?.name ?? id,
    probeSprite: (id) => content.probes.find((p) => p.id === id)?.sprite ?? 'probe-lumen',
    weaponName: (id) => content.weapons.find((w) => w.id === id)?.name ?? id,
  };
}

export function useContentNames(): ContentNames {
  const content = useLiveContent();
  return useMemo(() => contentNames(content), [content]);
}
