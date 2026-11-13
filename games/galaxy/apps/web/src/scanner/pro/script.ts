import { atLeast, TIERS, type PulledGalaxy, type Tier } from '@galaxy/shared';

/** The surge's swell runs this long before its burst (cues.ts plays it from the cue's time). */
export const SURGE_LEAD = 0.34;

/** The single card's wait is a moment of its own (the clock stops at its start), just before the summary. */
const HOLD = 0.01;

// The pro scanner's script (plan «escáner pro», part B; the owner: «las fases exactas de la animación para que yo pueda
// ir dirigiéndote»): the whole cinematic as data, built from the pulls. Phases one after another with their labels
// (the GSAP timeline's labels), the sounds on them, the flashes and shakes, the music's layers and where «Seguir»
// lands. Every duration lives in GUION, by phase and by tier, so a note from the owner is one number here — and the
// admin's «Ensayo» can try new ones (`overrides`) before they are written down.

/** The look of the trail: the neutral ice of the jump, or a tier's colour. */
export type TrailTint = Tier | 'ice';

export type PhaseKind = 'ignicion' | 'salto' | 'ascenso' | 'caida' | 'orbita' | 'colapso' | 'impacto' | 'carta' | 'fenomeno' | 'espera' | 'reparto' | 'giro' | 'solo' | 'final' | 'resumen';

/** What the reveal opens with: a scan's jump through the stars, or a fusion's galaxies spiralling into their core. */
export type Intro = 'scan' | 'fusion';

export interface Phase {
  /** Unique, and the timeline's label: `ignicion`, `giro-3`, `solo-9`… */
  label: string;
  /** The family it belongs to (what `overrides` change): `giro` for every `giro-k`. */
  kind: PhaseKind;
  at: number;
  dur: number;
  /** The card it shows (its place in the reveal order) and that pull's index and tier. */
  slot?: number;
  index?: number;
  tier?: Tier;
  /** Waits for the player (the single pull's card). */
  hold?: boolean;
  /** The impact's hit-stop: the world holds still this long before the strike. */
  lead?: number;
}

export type CueId =
  | 'latido'
  | 'salto'
  | 'ascenso'
  | 'meteoro'
  | 'impacto'
  | 'impacto-grande'
  | 'reparto'
  | 'giro'
  | 'revelar'
  | 'sello'
  | 'fanfarria'
  | 'fenomeno'
  | 'destacada'
  | 'acabado'
  | 'resumen';

export interface Cue {
  at: number;
  id: CueId;
  tier?: Tier;
  /** How long it should last (the jump's riser). */
  dur?: number;
  /** Still heard when «Seguir» lands on its moment (the reveal itself must never be silent). */
  essential?: boolean;
}

export interface Flash {
  at: number;
  /** 0–0.6 (photosensitivity: never a full white). */
  alpha: number;
  color: 'white' | TrailTint;
}

/** A card showing its face: when, and what comes with it. */
export interface Face {
  slot: number;
  index: number;
  at: number;
  featured: boolean;
  phenomenon: boolean;
}

export interface Shake {
  at: number;
  amp: number;
  dur: number;
}

export interface Script {
  intro: Intro;
  /** A fusion's galaxies going in (their tiers, in the order they sit round the ring); none for a scan. */
  inputs: readonly Tier[];
  count: number;
  reduced: boolean;
  maxTier: Tier;
  surge: boolean;
  /** What the jump's trail shows first (at 60 % of it) and what it ends on (after the surge). */
  trail: { shown: TrailTint; max: TrailTint };
  /** Pull indices in reveal order (rarest last; ties keep the server's order). */
  order: number[];
  phases: Phase[];
  cues: Cue[];
  flashes: Flash[];
  shakes: Shake[];
  /** The music's layer from each moment (0 base … 3 legendary or mythic): it only climbs. */
  score: { at: number; level: 0 | 1 | 2 | 3 }[];
  /** When each card shows its face (slot → time): the timeline waits for its image there. */
  faces: Face[];
  duration: number;
}

type ByTier = readonly [number, number, number, number, number, number];

/**
 * Every duration (seconds), by phase and by tier (common, uncommon, rare, epic, legendary, mythic). The mythic (plan
 * «rareza Mítica» M1) builds up a little longer than the legendary everywhere; its own, more epic cinematic is M2.
 */
export const GUION = {
  single: {
    ignicion: [0.8, 0.8, 0.9, 1.0, 1.2, 1.3] as ByTier,
    salto: [1.4, 1.5, 1.8, 2.2, 2.6, 2.9] as ByTier,
    ascenso: [0, 0, 0, 0.6, 0.9, 1.0] as ByTier,
    caida: [0.9, 0.9, 1.0, 1.1, 1.3, 1.4] as ByTier,
    impacto: [0.35, 0.4, 0.45, 0.5, 0.7, 0.8] as ByTier,
    /** The hit-stop: the world holds its breath at the impact. */
    paron: [0.04, 0.05, 0.06, 0.08, 0.2, 0.26] as ByTier,
    carta: [0.9, 0.9, 1.0, 1.3, 1.8, 2.1] as ByTier,
    fenomeno: 1.2,
    resumen: 0.6,
  },
  ten: {
    ignicion: [0.7, 0.7, 0.8, 0.85, 0.9, 0.95] as ByTier,
    salto: [1.2, 1.3, 1.6, 1.9, 2.2, 2.4] as ByTier,
    ascenso: [0, 0, 0, 0.5, 0.8, 0.9] as ByTier,
    caida: 1.4,
    /** Between one shooting star and the next. */
    caidaStagger: 0.06,
    impacto: 0.45,
    reparto: 0.9,
    /** From one card of the chain starting to turn to the next (they overlap: a cascade), by tier. */
    gap: [0.18, 0.24, 0.32, 0.32, 0.32, 0.32] as ByTier,
    /** How long a card of the chain takes to turn. */
    giro: 0.35,
    /** The card's edge lights with its tier this long before it turns. */
    aviso: 0.12,
    solo: { volar: 0.45, giro: 0.8, quieto: [0, 0, 0, 1.4, 2.4, 2.8] as ByTier, volver: 0.4 },
    final: 1.2,
    resumen: 0.6,
  },
  /**
   * A fusion (plan «fusión pro»): the galaxies going in appear round a dim core (one after another, `stagger` apart),
   * circle it faster and closer, and sink into it one by one; the burst and the new card are a single scan's.
   */
  fusion: {
    ignicion: 0.9,
    stagger: 0.05,
    orbita: [1.6, 1.7, 2.0, 2.3, 2.6, 2.6] as ByTier,
    ascenso: [0, 0, 0, 0.6, 0.9, 0.9] as ByTier,
    colapso: [0.8, 0.8, 0.9, 1.0, 1.1, 1.1] as ByTier,
  },
  /** Reduced motion: no jump, no impact, cards that fade round (a fusion's galaxies fade into the core). */
  calm: { ignicion: 0.5, colapso: 0.6, carta: 0.5, fenomeno: 0.9, reparto: 0.6, giro: 0.3, gap: 0.1, final: 0.6, resumen: 0.4 },
  /** How often the trail lies (and then breaks into the real colour), by the tier it ends on. */
  surge: { epic: 0.25, legendary: 0.35, mythic: 0.5 },
  /** The trail takes the shown colour at this share of the jump. */
  trailShift: 0.6,
  /** Never above 0.6 (photosensitivity); `legendaryFace` lights a legendary's or a mythic's face in its colour. */
  flash: { impact: [0.15, 0.2, 0.3, 0.45, 0.6, 0.6] as ByTier, surge: 0.5, legendaryFace: 0.5 },
  shake: { impact: [0.2, 0.3, 0.45, 0.7, 1, 1.15] as ByTier },
} as const;

const tierAt = (t: Tier) => TIERS.indexOf(t);

/** A number in [0, 1) from the pulls' ids (FNV-1a): the same scan always tells the same story. */
export function surgeRoll(pulls: readonly PulledGalaxy[]): number {
  let h = 0x811c9dc5;
  for (const p of pulls) {
    for (let i = 0; i < p.id.length; i++) {
      h ^= p.id.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return (h >>> 0) / 0x100000000;
}

export interface ScriptOptions {
  motion: 'full' | 'reduced';
  /** Forces the surge on or off (the Ensayo); by default the pulls' ids decide. */
  surge?: boolean;
  /** Durations by phase family (the Ensayo): `{ salto: 3 }`. */
  overrides?: Readonly<Partial<Record<PhaseKind, number>>>;
  /** A scan (the default) or a fusion, with the tiers of the galaxies going in. */
  intro?: Intro;
  inputs?: readonly Tier[];
}

export function buildScript(pulls: readonly PulledGalaxy[], opts: ScriptOptions): Script {
  const reduced = opts.motion === 'reduced';
  const intro: Intro = opts.intro ?? 'scan';
  const fusion = intro === 'fusion';
  const inputs = fusion ? [...(opts.inputs ?? [])] : [];
  const count = pulls.length;
  const ten = count > 1;
  const order = pulls.map((_, i) => i).sort((a, b) => tierAt(pulls[a]!.tier) - tierAt(pulls[b]!.tier) || a - b);
  const maxTier = pulls[order[order.length - 1]!]!.tier;
  const m = tierAt(maxTier);
  const canSurge = !reduced && atLeast(maxTier, 'epic');
  const surge = canSurge && (opts.surge ?? surgeRoll(pulls) < GUION.surge[maxTier as 'epic' | 'legendary' | 'mythic']);
  const anticipates = m >= tierAt('rare');
  const trail: Script['trail'] = { shown: anticipates ? (surge ? TIERS[m - 1]! : maxTier) : 'ice', max: anticipates ? maxTier : 'ice' };

  const phases: Phase[] = [];
  const cues: Cue[] = [];
  const flashes: Flash[] = [];
  const shakes: Shake[] = [];
  const faces: Face[] = [];
  let clock = 0;
  const dur = (kind: PhaseKind, value: number) => opts.overrides?.[kind] ?? value;
  const add = (label: string, kind: PhaseKind, length: number, extra: Partial<Phase> = {}): Phase => {
    const p: Phase = { label, kind, at: clock, dur: length, ...extra };
    phases.push(p);
    clock += length;
    return p;
  };
  /** The sounds and lights of a card showing its face at `at`. */
  const reveal = (g: PulledGalaxy, at: number, big: boolean) => {
    cues.push({ at, id: 'revelar', tier: g.tier, essential: true });
    if (big || !ten) cues.push({ at: at + 0.1, id: 'sello', tier: g.tier });
    const top = atLeast(g.tier, 'legendary');
    if (top && (big || !ten)) cues.push({ at: at + 0.1, id: 'fanfarria', essential: true });
    if (g.featured) cues.push({ at: at + 0.25, id: 'destacada', essential: true });
    if (g.finish !== 'normal') cues.push({ at: at + 0.15, id: 'acabado', tier: g.tier });
    if (top && big && !reduced) flashes.push({ at, alpha: GUION.flash.legendaryFace, color: g.tier });
  };

  if (reduced) {
    const C = GUION.calm;
    add('ignicion', 'ignicion', dur('ignicion', C.ignicion));
    // A fusion's galaxies fade into the core before the new card shows.
    if (fusion) add('colapso', 'colapso', dur('colapso', C.colapso));
    if (!ten) {
      const g = pulls[0]!;
      const card = add('carta', 'carta', dur('carta', C.carta), { slot: 0, index: 0, tier: g.tier });
      faces.push({ slot: 0, index: 0, at: card.at + card.dur * 0.5, featured: g.featured, phenomenon: hasPhenomenon(g) });
      cues.push({ at: card.at + card.dur * 0.3, id: 'giro' });
      reveal(g, card.at + card.dur * 0.5, true);
      if (hasPhenomenon(g)) {
        const f = add('fenomeno', 'fenomeno', dur('fenomeno', C.fenomeno), { slot: 0, index: 0, tier: g.tier });
        cues.push({ at: f.at, id: 'fenomeno' });
      }
      add('espera-carta', 'espera', HOLD, { hold: true, slot: 0, index: 0, tier: g.tier });
    } else {
      const deal = add('reparto', 'reparto', dur('reparto', C.reparto));
      cues.push({ at: deal.at, id: 'reparto' });
      order.forEach((index, slot) => {
        const g = pulls[index]!;
        const length = C.gap + dur('giro', C.giro);
        const p = add(`giro-${slot}`, 'giro', length, { slot, index, tier: g.tier });
        const face = p.at + C.gap + (p.dur - C.gap) * 0.5;
        faces.push({ slot, index, at: face, featured: g.featured, phenomenon: hasPhenomenon(g) });
        reveal(g, face, false);
      });
      add('final', 'final', dur('final', C.final));
    }
  } else {
    const S = GUION.single;
    const T = GUION.ten;
    const F = GUION.fusion;
    const ign = add('ignicion', 'ignicion', dur('ignicion', fusion ? F.ignicion : (ten ? T : S).ignicion[m]!));
    cues.push({ at: ign.at + 0.05, id: 'latido' }, { at: ign.at + 0.5 * ign.dur, id: 'latido' });
    // A scan jumps through the stars; a fusion's ring turns faster and closer round its core (the same riser).
    const jump = fusion ? add('orbita', 'orbita', dur('orbita', F.orbita[m]!)) : add('salto', 'salto', dur('salto', (ten ? T : S).salto[m]!));
    let rise = jump.dur;
    if (surge) {
      const up = add('ascenso', 'ascenso', dur('ascenso', (fusion ? F : ten ? T : S).ascenso[m]!));
      rise += up.dur;
      // Its swell starts before the burst (cues.ts SURGE_LEAD), so the burst lands with the flash.
      cues.push({ at: Math.max(up.at, up.at + up.dur * 0.6 - SURGE_LEAD), id: 'ascenso', tier: maxTier });
      flashes.push({ at: up.at + up.dur * 0.6, alpha: GUION.flash.surge, color: maxTier });
    }
    cues.push({ at: jump.at, id: 'salto', tier: maxTier, dur: rise });
    // A scan's shooting stars fall; a fusion's galaxies sink into the core.
    const fall = fusion ? add('colapso', 'colapso', dur('colapso', F.colapso[m]!)) : add('caida', 'caida', dur('caida', ten ? T.caida : S.caida[m]!));
    cues.push({ at: fall.at, id: 'meteoro', tier: maxTier });
    const hit = add('impacto', 'impacto', dur('impacto', ten ? T.impacto : S.impacto[m]!) + S.paron[m]!, { lead: S.paron[m]! });
    const strike = hit.at + S.paron[m]!;
    cues.push({ at: hit.at, id: m >= tierAt('epic') ? 'impacto-grande' : 'impacto', tier: maxTier, essential: true });
    flashes.push({ at: strike, alpha: GUION.flash.impact[m]!, color: 'white' });
    shakes.push({ at: strike, amp: GUION.shake.impact[m]!, dur: 0.45 + 0.1 * m });

    if (!ten) {
      const g = pulls[0]!;
      const card = add('carta', 'carta', dur('carta', S.carta[m]!), { slot: 0, index: 0, tier: g.tier });
      const face = card.at + card.dur * 0.6;
      cues.push({ at: card.at + card.dur * 0.3, id: 'giro' });
      faces.push({ slot: 0, index: 0, at: face, featured: g.featured, phenomenon: hasPhenomenon(g) });
      reveal(g, face, true);
      if (atLeast(g.tier, 'legendary')) shakes.push({ at: face + 0.1, amp: g.tier === 'mythic' ? 0.6 : 0.5, dur: 0.35 });
      if (hasPhenomenon(g)) {
        const f = add('fenomeno', 'fenomeno', dur('fenomeno', S.fenomeno), { slot: 0, index: 0, tier: g.tier });
        cues.push({ at: f.at, id: 'fenomeno' });
      }
      add('espera-carta', 'espera', HOLD, { hold: true, slot: 0, index: 0, tier: g.tier });
    } else {
      const deal = add('reparto', 'reparto', dur('reparto', T.reparto));
      cues.push({ at: deal.at, id: 'reparto' });
      order.forEach((index, slot) => {
        const g = pulls[index]!;
        const t = tierAt(g.tier);
        if (t >= tierAt('epic')) {
          const turn = T.solo.giro;
          const length = dur('solo', T.solo.volar + turn + T.solo.quieto[t]! + T.solo.volver);
          const p = add(`solo-${slot}`, 'solo', length, { slot, index, tier: g.tier });
          const face = p.at + T.solo.volar + turn * 0.6;
          cues.push({ at: p.at + T.solo.volar, id: 'giro' });
          faces.push({ slot, index, at: face, featured: g.featured, phenomenon: hasPhenomenon(g) });
          reveal(g, face, true);
          if (atLeast(g.tier, 'legendary')) shakes.push({ at: face + 0.1, amp: g.tier === 'mythic' ? 0.6 : 0.5, dur: 0.35 });
          if (hasPhenomenon(g)) cues.push({ at: face + 0.4, id: 'fenomeno' });
        } else {
          // A cascade: each card starts turning `gap` after the last (its edge lit first), before it has finished.
          const p = add(`giro-${slot}`, 'giro', dur('giro', T.gap[t]!), { slot, index, tier: g.tier });
          const face = p.at + T.aviso + T.giro * 0.6;
          cues.push({ at: p.at + T.aviso, id: 'giro' });
          faces.push({ slot, index, at: face, featured: g.featured, phenomenon: hasPhenomenon(g) });
          reveal(g, face, false);
        }
      });
      add('final', 'final', dur('final', T.final));
    }
  }
  const end = add('resumen', 'resumen', dur('resumen', reduced ? GUION.calm.resumen : ten ? GUION.ten.resumen : GUION.single.resumen));
  cues.push({ at: end.at, id: 'resumen', tier: maxTier });

  // The music: the base from the ignition, then a layer more each time a rarer card shows its face.
  const score: Script['score'] = [{ at: 0, level: 0 }];
  let level = 0;
  for (const f of [...faces].sort((a, b) => a.at - b.at)) {
    const t = tierAt(pulls[f.index]!.tier);
    const want = t >= tierAt('legendary') ? 3 : t >= tierAt('epic') ? 2 : t >= tierAt('rare') ? 1 : 0;
    if (want > level) {
      level = want;
      score.push({ at: f.at, level: want as 1 | 2 | 3 });
    }
  }
  cues.sort((a, b) => a.at - b.at);
  return { intro, inputs, count, reduced, maxTier, surge, trail, order, phases, cues, flashes, shakes, score, faces, duration: end.at + end.dur };
}

function hasPhenomenon(g: PulledGalaxy): boolean {
  const p = g.traits['phenomenon'];
  return !!p && p !== 'none';
}

/** The phase playing at `t` (the last one once it is over). */
export function phaseAt(s: Script, t: number): Phase {
  let found = s.phases[0]!;
  for (const p of s.phases) if (p.at <= t + 1e-9) found = p;
  return found;
}

const first = (s: Script, kind: PhaseKind) => s.phases.find((p) => p.kind === kind);

/**
 * Where «Seguir» (a click, Space) lands from `t`. A single pull: before the card, its card (the turn still plays);
 * during it, its wait; then the summary. Ten: before the deal, the deal; along the chain, the next close-up (or the
 * end); in a close-up, its way back. The reveal is never skipped, only hurried.
 */
export function nextStop(s: Script, t: number): number {
  const summary = first(s, 'resumen')!.at;
  if (s.count <= 1) {
    const card = first(s, 'carta');
    const hold = first(s, 'espera');
    if (card && t < card.at - 1e-9) return card.at;
    if (hold && t < hold.at - 1e-9) return hold.at;
    return summary;
  }
  const deal = first(s, 'reparto');
  if (deal && t < deal.at - 1e-9) return deal.at;
  const now = phaseAt(s, t);
  if (now.kind === 'solo') {
    const back = now.at + now.dur - GUION.ten.solo.volver;
    if (t < back - 1e-9) return back;
  }
  if (now.kind === 'final' || now.kind === 'resumen') return summary;
  const next = s.phases.find((p) => p.at > t + 1e-9 && (p.kind === 'solo' || p.kind === 'final'));
  return next?.at ?? summary;
}

/** The most flashes inside any one-second window (photosensitivity, WCAG 2.3.1: never more than 2). */
export function maxFlashesPerSecond(flashes: readonly Flash[]): number {
  const times = flashes.map((f) => f.at).sort((a, b) => a - b);
  let most = 0;
  for (let i = 0; i < times.length; i++) {
    let k = i;
    while (k + 1 < times.length && times[k + 1]! - times[i]! < 1) k++;
    most = Math.max(most, k - i + 1);
  }
  return most;
}
