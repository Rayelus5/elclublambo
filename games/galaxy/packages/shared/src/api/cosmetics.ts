import type { CosmeticsConfig } from '../cosmetics/catalog';

// «Personalizar» (Nov plan C2): what the player wears, what they have, and the live catalog of pieces (enabled ones),
// with how to get each. Default avatars are everyone's and never listed as owned.
export interface CosmeticsView {
  equipped: { avatar: string | null; frame: string | null; title: string | null; banner: string | null };
  owned: { avatars: string[]; frames: string[]; titles: string[] };
  catalog: CosmeticsConfig;
}

/** How a player shows next to their name anywhere (lists, chat, rooms): their avatar and frame (null: none). */
export interface PlayerLook {
  avatar?: string | null;
  frame?: string | null;
}
