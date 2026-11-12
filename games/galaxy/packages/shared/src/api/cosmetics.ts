import type { CosmeticsConfig } from '../cosmetics/catalog';

// «Personalizar» (Nov plan C2): what the player wears, what they have, and the live catalog of pieces (enabled ones),
// with how to get each. Default avatars are everyone's and never listed as owned.
export interface CosmeticsView {
  equipped: { avatar: string | null; frame: string | null; title: string | null; banner: string | null; backdrop: string[] };
  owned: { avatars: string[]; frames: string[]; titles: string[] };
  catalog: CosmeticsConfig;
}

/** The title screen's sky (plan «escáner pro», part E): the galaxies chosen, or the rarest when none is. */
export interface BackdropView {
  galaxies: { id: string; seed: string; traits: Record<string, string> }[];
  chosen: boolean;
}

/** How a player shows next to their name anywhere (lists, chat, rooms): their avatar and frame (null: none). */
export interface PlayerLook {
  avatar?: string | null;
  frame?: string | null;
}
