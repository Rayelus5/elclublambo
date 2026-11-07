import type { StationConfig } from './rooms';

// The antenna (GDD §10.4; M4a plan ruling 5): a small drip of signals, at its level's rate per hour, counted with the
// server's hour and capped at `capHours` accumulated. Collecting pays the whole signals and keeps the time of the
// fraction, within the cap. Broken (level 0), it gives nothing.

const HOUR = 3_600_000;

/** Its level's rate per hour, pushed by the Laboratorio (`boost`, a fraction added; M4b-2). */
export function antennaRate(level: number, cfg: StationConfig, boost = 0): number {
  return level <= 0 ? 0 : cfg.antenna.levels[Math.min(level, cfg.antenna.levels.length) - 1]!.rate * (1 + boost);
}

/** What collecting now would pay, and the clock afterwards. */
export function antennaAccrued(clock: Date, level: number, cfg: StationConfig, now: Date, boost = 0): { signals: number; clock: Date } {
  const rate = antennaRate(level, cfg, boost);
  const cap = cfg.antenna.capHours * HOUR;
  const elapsed = Math.max(0, Math.min(cap, now.getTime() - clock.getTime()));
  if (rate <= 0 || elapsed <= 0) return { signals: 0, clock: elapsed <= 0 ? clock : now };
  const signals = Math.floor((rate * elapsed) / HOUR + 1e-9);
  const used = Math.round((signals * HOUR) / rate);
  // The accrual window starts `elapsed` before now (older time beyond the cap is lost); the paid time leaves it.
  return { signals, clock: new Date(now.getTime() - elapsed + used) };
}

/** When the antenna reaches its cap (it stops accruing then). */
export function antennaFullAt(clock: Date, cfg: StationConfig): Date {
  return new Date(clock.getTime() + cfg.antenna.capHours * HOUR);
}
