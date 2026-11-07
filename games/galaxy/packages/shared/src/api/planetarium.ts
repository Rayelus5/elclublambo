import { z } from 'zod';
import { usernameSchema } from '../account';
import type { GalaxySummary, PulledGalaxy } from './economy';

// The planetarium's API (GDD §10.5, §14.2; M4c-2): a player's own planetarium with its pedestals, prestige, bonus and
// visits, the featured ones to visit, and a visit to someone else's, which shows only what they exhibit.

/** A galaxy as anyone may see it on a pedestal: the card and its level, nothing about its owner's account. */
export interface PublicGalaxy extends PulledGalaxy {
  level: number;
}

/** A planetarium in the featured list. */
export interface PlanetariumCard {
  owner: string;
  prestige: number;
  /** How many pedestals hold a galaxy. */
  exhibits: number;
  /** Its most prestigious galaxy, for the card's picture. */
  cover: PublicGalaxy | null;
}

export interface PlanetariumView {
  /** How many pedestals there are. */
  slots: number;
  /** One per pedestal, in order; null is an empty pedestal. */
  exhibits: (GalaxySummary | null)[];
  prestige: number;
  /** The experience bonus in runs (a fraction: 0.016 = 1.6 %). */
  bonus: number;
  /** Visits received: one per visitor and day. */
  visits: number;
  featured: PlanetariumCard[];
}

export interface PlanetariumVisit {
  owner: string;
  exhibits: (PublicGalaxy | null)[];
  prestige: number;
  visits: number;
}

/** What each pedestal holds, in order (null: empty). Up to eight; the live config says how many there are. */
export const exhibitsSchema = z
  .object({ galaxies: z.array(z.uuid().nullable()).min(1).max(8) })
  .strict()
  .refine((r) => {
    const ids = r.galaxies.filter((x): x is string => x !== null);
    return new Set(ids).size === ids.length;
  }, 'duplicate_ids');
export type ExhibitsRequest = z.infer<typeof exhibitsSchema>;

export const usernameParamSchema = z.object({ username: usernameSchema }).strict();
