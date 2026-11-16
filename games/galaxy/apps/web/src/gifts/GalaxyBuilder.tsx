import { type Finish, FINISHES, type FeaturedTrait, galaxyReachable, generateGalaxy, type Gift, type PulledGalaxy, type Tier, TIERS, TRAIT_KEYS } from '@galaxy/shared';
import { useEffect, useId, useState } from 'react';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy } from '../copy/es';
import { randomSeed } from '../scanner/pro/fabricate';
import { Icon } from '../ui/Icon';
import { Segmented } from '../ui/Segmented';
import { Select } from '../ui/Select';

// The galaxies tab (mail v2, P3): a galaxy built by its tier, its finish and, if wanted, one trait with its value
// («una legendaria espiral»), up to five of them. Each player gets their own, made when they claim it; the card here is
// one sample of how it can come out, made in the browser with the game's own generator, on request. A trait some
// tiers never carry is said before adding it (the server checks it again).

const g = copy.gifts.galaxy;
const traitValues = (key: string) => Object.entries((copy.traitValues as Record<string, Record<string, string>>)[key] ?? {}).filter(([v]) => v !== 'none');
const TRAITS = TRAIT_KEYS.filter((k) => traitValues(k).length > 0);
const SAMPLE_CANDIDATES = 400_000;

type Reach = 'yes' | 'no' | 'checking';

export function GalaxyBuilder({ disabled, onAdd }: { disabled: boolean; onAdd: (gift: Gift) => void }) {
  const ids = useId();
  const [tier, setTier] = useState<Tier>('epic');
  const [picked, setFinish] = useState<Finish>('normal');
  const [trait, setTrait] = useState<FeaturedTrait | ''>('');
  const [value, setValue] = useState('');
  const [count, setCount] = useState('1');
  const [checked, setChecked] = useState<{ key: string; ok: boolean } | null>(null);
  const [made, setSample] = useState<{ key: string; galaxy: PulledGalaxy } | null>(null);
  const [making, setMaking] = useState(false);
  const mythic = tier === 'mythic';
  // A mythic always has a special finish (the scanner never gives a plain one).
  const finish: Finish = mythic && picked === 'normal' ? 'prismatic' : picked;
  const chosen = trait && value ? { key: trait, value } : null;
  // What the reachability and the sample are of: a change of tier or trait makes them old.
  const key = `${tier}|${trait}|${value}`;
  const plain = !chosen && !mythic;

  // Whether such a galaxy can come out: at once for a plain one, a moment later (the page first) with a trait.
  useEffect(() => {
    if (plain) return;
    const t = setTimeout(() => setChecked({ key, ok: galaxyReachable(TIERS.indexOf(tier), trait && value ? { key: trait, value } : null) }), 0);
    return () => clearTimeout(t);
  }, [plain, key, tier, trait, value]);
  const reach: Reach = plain ? 'yes' : checked?.key === key ? (checked.ok ? 'yes' : 'no') : 'checking';
  const sample = made?.key === key ? { ...made.galaxy, finish } : null;

  const n = Math.max(1, Math.min(5, Number(count) || 1));
  const makeSample = () => {
    setMaking(true);
    setTimeout(() => {
      try {
        const g = generateGalaxy(randomSeed(), TIERS.indexOf(tier), chosen ? { trait: chosen.key, value: chosen.value } : undefined, SAMPLE_CANDIDATES);
        const galaxy: PulledGalaxy = { id: `muestra-${g.seed}`, seed: g.seed.toString(), tier, finish, traits: { ...(g.traits as unknown as Record<string, string>) }, name: g.name, designation: g.designation, featured: false };
        setSample({ key, galaxy });
      } catch {
        setSample(null);
      } finally {
        setMaking(false);
      }
    }, 0);
  };

  return (
    <div className="gift-builder">
      <div className="gift-builder-form">
        <div className="field">
          <span className="field-label" id={`${ids}-tier`}>
            {g.tier}
          </span>
          <Segmented<Tier> aria-labelledby={`${ids}-tier`} className="gift-tiers" value={tier} options={TIERS.map((t) => ({ value: t, label: copy.tiers[t] }))} onChange={setTier} />
        </div>
        <div className="field">
          <span className="field-label" id={`${ids}-finish`}>
            {g.finish}
          </span>
          <Segmented<Finish>
            aria-labelledby={`${ids}-finish`}
            className="gift-finishes"
            value={finish}
            options={FINISHES.map((f) => ({ value: f, label: copy.finishes[f], disabled: mythic && f === 'normal' }))}
            onChange={setFinish}
          />
          {mythic ? <p className="hint">{g.mythicFinish}</p> : null}
        </div>
        <div className="gift-builder-row">
          <div className="field">
            <label htmlFor={`${ids}-trait`}>{g.trait}</label>
            <Select<FeaturedTrait | ''>
              id={`${ids}-trait`}
              size="lg"
              block
              value={trait}
              options={[{ value: '' as const, label: g.traitAny }, ...TRAITS.map((k) => ({ value: k, label: copy.traitNames[k] ?? k }))]}
              onChange={(k) => {
                setTrait(k);
                setValue(k ? (traitValues(k)[0]?.[0] ?? '') : '');
              }}
            />
          </div>
          {trait ? (
            <div className="field">
              <label htmlFor={`${ids}-value`}>{g.value}</label>
              <Select id={`${ids}-value`} size="lg" block value={value} options={traitValues(trait).map(([v, label]) => ({ value: v, label }))} onChange={setValue} />
            </div>
          ) : null}
          <div className="field gift-builder-count">
            <label htmlFor={`${ids}-count`}>{g.count}</label>
            <input id={`${ids}-count`} inputMode="numeric" autoComplete="off" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 1))} />
          </div>
        </div>
        {reach === 'no' ? (
          <p className="field-error" role="alert">
            {g.unreachable}
          </p>
        ) : null}
        <div className="gift-builder-actions">
          <button type="button" className="lip pill" disabled={disabled || reach !== 'yes'} aria-busy={reach === 'checking' || undefined} onClick={() => onAdd({ kind: 'galaxy', tier, finish, trait: chosen, count: n })}>
            <Icon name="plus" />
            <span>{copy.gifts.add}</span>
          </button>
          <button type="button" className="lip pill small" disabled={reach !== 'yes' || making} aria-busy={making || undefined} onClick={makeSample}>
            {sample ? g.another : g.sample}
          </button>
        </div>
      </div>
      <figure className="gift-builder-sample" data-tier={tier}>
        {sample ? <GalaxyCard galaxy={sample} size={176} /> : <span className="gift-builder-empty" aria-hidden="true" />}
        <figcaption className="hint">{making ? g.making : g.sampleNote}</figcaption>
      </figure>
    </div>
  );
}
