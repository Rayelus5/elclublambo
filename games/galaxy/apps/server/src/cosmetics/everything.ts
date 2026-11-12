import type { CosmeticsConfig, ShopProduct } from '@galaxy/shared';

// What `grant-cosmetics` gives (CLI): every piece a player can own (`all`) or only the shop's (`shop`). «Everything» is
// the cosmetics catalog plus every reward of the live config handed in `rewards` (achievements, missions, events, the
// album, the season route and its shop…): any object there with `title`, `frame` and `avatar` keys is a reward, so a
// title an event gives counts though the catalog does not list it (and its `skin`, plan «skins»). Default pieces are
// everyone's already: never given.

export type GrantScope = 'all' | 'shop';
export interface GrantSources {
  cosmetics: CosmeticsConfig;
  shopProducts: readonly ShopProduct[];
  rewards: readonly unknown[];
}
export interface Pieces {
  avatars: string[];
  frames: string[];
  titles: string[];
  skins: string[];
}

export function cosmeticsToGrant(s: GrantSources, scope: GrantScope): Pieces {
  const avatars = new Set<string>();
  const frames = new Set<string>();
  const titles = new Set<string>();
  const skins = new Set<string>();
  const wanted = (source: string) => source === 'shop' || (scope === 'all' && source === 'reward');
  for (const a of s.cosmetics.avatars) if (wanted(a.source)) avatars.add(a.id);
  for (const f of s.cosmetics.frames) if (wanted(f.source)) frames.add(f.id);
  for (const t of s.cosmetics.titles) if (wanted(t.source)) titles.add(t.text);
  for (const k of s.cosmetics.skins) if (wanted(k.source)) skins.add(k.id);
  for (const p of s.shopProducts) {
    if (p.kind !== 'cosmetic' || !p.cosmetic) continue;
    ({ avatar: avatars, frame: frames, title: titles, skin: skins })[p.cosmetic.kind].add(p.cosmetic.id);
  }
  if (scope === 'all') {
    const defaults = new Set<string>([...s.cosmetics.avatars, ...s.cosmetics.frames].filter((x) => x.source === 'default').map((x) => x.id));
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== 'object') return;
      const o = v as Record<string, unknown>;
      if ('title' in o && 'frame' in o && 'avatar' in o) {
        if (typeof o['title'] === 'string') titles.add(o['title']);
        if (typeof o['frame'] === 'string' && !defaults.has(o['frame'])) frames.add(o['frame']);
        if (typeof o['avatar'] === 'string' && !defaults.has(o['avatar'])) avatars.add(o['avatar']);
        if (typeof o['skin'] === 'string') skins.add(o['skin']);
      }
      Object.values(o).forEach(walk);
    };
    s.rewards.forEach(walk);
  }
  return { avatars: [...avatars], frames: [...frames], titles: [...titles], skins: [...skins] };
}
