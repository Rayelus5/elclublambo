import { TIERS, type GalaxySummary, type HangarView } from '@galaxy/shared';
import { activeSets, DEFAULT_CONTENT, describeRelic, type RelicInput } from '@galaxy/sim';
import { type CSSProperties, useId, useLayoutEffect, useRef, useState } from 'react';
import { useGacha } from '../../api/economy';
import { useSetLoadout, useUnlockSlot } from '../../api/runs';
import { errorText } from '../../auth/useMe';
import { useGalaxyImage } from '../../cards/useGalaxyImage';
import { copy } from '../../copy/es';
import { emitTour } from '../../tour/bus';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { RelicPicker } from '../RelicPicker';
import { SetsPanel } from '../SetsPanel';
import { StepHead } from './WherePanel';

// Step 3, with what (GDD §8.4): the relic slots along the lobby's foot. A relic is its galaxy as an orb ringed in its
// tier's colour, with its family and power; an empty slot asks for one; the next slot shows what opens it (and «Abrir
// ranura» once it is earned); the rest are small locks. The sets the relics make open in their own window.

const TIER_COLOR: Record<string, string> = { common: '#c9d0ea', uncommon: '#45e3a6', rare: '#6fb7ff', epic: '#b39dff', legendary: '#ffc94a' };

export function relicInput(g: GalaxySummary): RelicInput {
  return { id: g.id, seed: g.seed, tier: TIERS.indexOf(g.tier), level: g.level, traits: g.traits };
}

/** A galaxy drawn small and round (the relic's orb). */
function Orb({ seed, size }: { seed: string; size: number }) {
  const { ref, canvas, state } = useGalaxyImage(seed, 96, size);
  const host = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!host.current || !canvas) return;
    host.current.prepend(canvas);
    return () => canvas.remove();
  }, [canvas]);
  return (
    <span ref={ref} className="lobby-orb" data-state={state} style={{ inlineSize: size, blockSize: size }} aria-hidden="true">
      <span ref={host} className="lobby-orb-art" />
    </span>
  );
}

/** The next relic slot (M4c-1): what opens it with its bar, then «Abrir ranura» with its dust. */
function NextSlot({ next }: { next: NonNullable<HangarView['nextSlot']> }) {
  const unlock = useUnlockSlot();
  const dust = useGacha().data?.wallet.dust;
  const short = dust === undefined ? null : Math.max(0, next.dust - dust);
  const have = Math.min(next.condition.value, Math.round(next.progress * next.condition.value));
  const condition = copy.hangar.unlock[next.condition.stat](next.condition.value);
  const missing = useId();
  return (
    <li className={`lobby-slot next${next.ready ? ' ready' : ''}`} role="group" aria-label={copy.hangar.slot(next.slot)}>
      <span className="lobby-slot-lock" aria-hidden="true">
        <Icon name="lock" />
      </span>
      <span className="lobby-slot-condition">{condition}</span>
      <span
        className="lobby-slot-bar"
        role="progressbar"
        aria-label={condition}
        aria-valuemin={0}
        aria-valuemax={next.condition.value}
        aria-valuenow={have}
        aria-valuetext={copy.hangar.slotProgress(have, next.condition.value)}
      >
        <i style={{ inlineSize: `${next.progress * 100}%` }} />
      </span>
      <small className="lobby-slot-count">
        {have}/{next.condition.value}
      </small>
      {next.ready ? (
        <>
          <button
            type="button"
            className="lip pill pill-solar small"
            disabled={short === null || short > 0 || unlock.isPending}
            aria-busy={unlock.isPending || undefined}
            aria-describedby={short !== null && short > 0 ? missing : undefined}
            onClick={() => unlock.mutate(next.slot)}
          >
            <span>{copy.hangar.openSlot}</span>
            <small>{copy.collection.levelCost(next.dust)}</small>
          </button>
          {short !== null && short > 0 ? (
            <small className="lobby-slot-short" id={missing}>
              {copy.lab.missing(short, 0)}
            </small>
          ) : null}
        </>
      ) : null}
      {unlock.error ? (
        <small className="field-error" role="alert">
          {errorText(unlock.error, copy.errors)}
        </small>
      ) : null}
    </li>
  );
}

export function RelicStrip({ view }: { view: HangarView }) {
  const setLoadout = useSetLoadout();
  const [picking, setPicking] = useState<number | null>(null);
  const [sets, setSets] = useState(false);
  const ids = view.loadout.map((g) => g?.id ?? null);
  const all = view.loadout.filter((g): g is GalaxySummary => g !== null).map(relicInput);
  // The same family stacked (GDD §8.6): said when some family has as many relics as the rule starts at.
  const families = all.map((r) => describeRelic(r, all, DEFAULT_CONTENT).family);
  const stacked = families.some((f) => families.filter((x) => x === f).length >= DEFAULT_CONTENT.relics.stacking.from);
  const active = activeSets(all, DEFAULT_CONTENT).length;
  const save = (next: (string | null)[]) => setLoadout.mutate(next, { onSuccess: () => (next.some((x) => x !== null) ? emitTour('hangar:relicEquipped') : undefined) });
  const firstEmpty = view.loadout.findIndex((x, i) => i < view.slots && !x);
  const locked = Math.max(0, view.maxSlots - view.slots - (view.nextSlot ? 1 : 0));

  return (
    <section className="lip panel lobby-relics" aria-labelledby="lobby-relics">
      <header className="lobby-relics-head">
        <StepHead n={3}>{copy.lobby.what}</StepHead>
        <h2 id="lobby-relics">{copy.hangar.relics}</h2>
        <button type="button" className={`lip pill small lobby-sets-btn${active ? ' on' : ''}`} aria-haspopup="dialog" onClick={() => setSets(true)}>
          <Icon name="cards" />
          <span>{copy.hangar.sets}</span>
          {active ? <span className="lobby-sets-count">{copy.lobby.setsCount(active)}</span> : null}
        </button>
      </header>
      <ol className="lobby-slots">
        {Array.from({ length: view.slots }, (_, i) => {
          const g = view.loadout[i];
          if (!g) {
            return (
              <li key={i} className="lobby-slot empty" data-tour={i === firstEmpty ? 'relic-slot' : undefined}>
                <button type="button" className="lobby-slot-add" onClick={() => setPicking(i)}>
                  <Icon name="plus" />
                  <span>{copy.hangar.chooseRelic}</span>
                </button>
              </li>
            );
          }
          const skill = describeRelic(relicInput(g), all, DEFAULT_CONTENT);
          // What it does in words: its family, then its element and phenomenon when it has them.
          const does = [copy.hangar.families[skill.family], skill.element ? copy.hangar.elements[skill.element] : null, skill.phenomenon ? copy.hangar.phenomena[skill.phenomenon] : null]
            .filter(Boolean)
            .join(', ');
          return (
            <li key={i} className="lobby-slot filled" role="group" aria-label={copy.hangar.slot(i + 1)} style={{ '--tier': TIER_COLOR[g.tier] ?? '#c9d0ea' } as CSSProperties}>
              <button type="button" className="lobby-slot-swap" onClick={() => setPicking(i)} title={`${g.name}: ${does}`}>
                <Orb seed={g.seed} size={60} />
                <span className="lobby-slot-text">
                  <b>{g.name}</b>
                  <small>{does}</small>
                  <small className="lobby-slot-power">{copy.hangar.power(skill.magnitude)}</small>
                </span>
              </button>
              <button type="button" className="lobby-slot-remove" onClick={() => {
                const next = [...ids];
                next[i] = null;
                save(next);
              }} aria-label={copy.hangar.unequip(g.name)}>
                <Icon name="close" />
              </button>
            </li>
          );
        })}
        {view.nextSlot ? <NextSlot next={view.nextSlot} /> : null}
        {Array.from({ length: locked }, (_, k) => (
          <li key={`locked-${k}`} className="lobby-slot locked" title={copy.hangar.lockedSlot}>
            <Icon name="lock" />
            <span className="sr-only">{copy.hangar.lockedSlot}</span>
          </li>
        ))}
      </ol>
      {stacked ? <p className="lobby-relics-note">{copy.hangar.stacking}</p> : null}
      {setLoadout.error ? (
        <p className="field-error" role="alert">
          {errorText(setLoadout.error, copy.errors)}
        </p>
      ) : null}
      {sets ? (
        <Dialog title={copy.hangar.sets} hideTitle onClose={() => setSets(false)} className="lobby-sets-dialog">
          <SetsPanel relics={all} />
        </Dialog>
      ) : null}
      {picking !== null ? (
        <RelicPicker
          taken={new Set(ids.filter((x): x is string => x !== null && x !== ids[picking]))}
          onClose={() => setPicking(null)}
          onPick={(g) => {
            const next = ids.map((x) => (x === g.id ? null : x));
            next[picking] = g.id;
            save(next);
            setPicking(null);
          }}
        />
      ) : null}
    </section>
  );
}
