import { DASH, MOVE, PICK_SEQ, PRESENCE } from './log';
import { IDLE, type ProbeInput } from './types';

// The co-op input feed (multiplayer plan, phase 6). The server seals every input as a log event (the format of
// log.ts: [tick, probe, kind, a, b, c]) and hands the events out in batches; the referee, each client and the
// replayer turn them into the inputs of each tick the same way. Moves and presence stay in effect from their tick on
// (sticky); a pick counts on its tick only, with the offer it names, and so does a dash (SIM 1.12.0), with its angle.

const COMPACT_AT = 6 * 4096;

export class CoopFeed {
  private readonly current: ProbeInput[];
  private ev: number[] = [];
  private at = 0;

  constructor(probes: number) {
    this.current = Array.from({ length: probes }, () => ({ ...IDLE, presence: 0 }));
  }

  /** More sealed events, in tick order (a batch may end anywhere between two events). */
  push(events: readonly number[]): void {
    for (const e of events) this.ev.push(e);
  }

  /** The inputs of the step that simulates `tick`: every event up to it taken in order. Ticks are asked in order. */
  inputsFor(tick: number): ProbeInput[] {
    const inputs: ProbeInput[] = this.current.map((c) => ({ ...c, pick: -1 }));
    const ev = this.ev;
    while (this.at + 5 < ev.length && ev[this.at]! <= tick) {
      const i = this.at;
      const p = ev[i + 1]!;
      const kind = ev[i + 2]!;
      if (p < this.current.length) {
        if (kind === MOVE) {
          this.current[p] = { ...this.current[p]!, mx: ev[i + 3]!, my: ev[i + 4]!, aim: ev[i + 5]! };
          inputs[p] = { ...inputs[p]!, mx: ev[i + 3]!, my: ev[i + 4]!, aim: ev[i + 5]! };
        } else if (kind === PRESENCE) {
          this.current[p] = { ...this.current[p]!, presence: ev[i + 3]! };
          inputs[p] = { ...inputs[p]!, presence: ev[i + 3]! };
        } else if (kind === PICK_SEQ && ev[i]! === tick) {
          inputs[p] = { ...inputs[p]!, pick: ev[i + 3]!, offer: ev[i + 4]! };
        } else if (kind === DASH && ev[i]! === tick) {
          inputs[p] = { ...inputs[p]!, dash: ev[i + 3]! };
        }
      }
      this.at += 6;
    }
    if (this.at >= COMPACT_AT) {
      this.ev = this.ev.slice(this.at);
      this.at = 0;
    }
    return inputs;
  }
}
