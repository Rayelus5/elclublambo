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

/**
 * The sky's order (plan «escáner pro», part E: «no ordenada, sino aleatoria»): `laps` shuffles of the seeds one after
 * another (Fisher–Yates), each lap showing every galaxy once, and never the same one twice in a row across laps.
 */
export function shuffledLaps(seeds: readonly string[], laps: number, rand: () => number = Math.random): string[] {
  const out: string[] = [];
  for (let lap = 0; lap < laps && seeds.length > 0; lap++) {
    const order = [...seeds];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    // The lap must not start with the galaxy the last one ended on.
    if (order.length > 1 && order[0] === out[out.length - 1]) [order[0], order[1]] = [order[1]!, order[0]!];
    out.push(...order);
  }
  return out;
}
