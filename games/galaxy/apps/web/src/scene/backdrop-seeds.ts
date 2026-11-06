// Which galaxies the title screen's sky shows (DESIGN_SYSTEM §8): the player's own, in the order given (rarest
// first), except the paper-white Antimatter palette and the Anomaly glitch, which would look like a broken screen.
type Candidate = { seed: string; traits: Readonly<Record<string, string>> };

export function backdropSeeds(galaxies: readonly Candidate[]): string[] {
  return galaxies.filter((g) => g.traits['palette'] !== 'antimatter' && g.traits['phenomenon'] !== 'anomaly').map((g) => g.seed);
}

/** The seed for backdrop galaxy `id` (ids count up from 1): the collection's galaxies take turns; none → null (random). */
export function seedFor(seeds: readonly string[], id: number): bigint | null {
  return seeds.length === 0 ? null : BigInt(seeds[(id - 1) % seeds.length]!);
}
