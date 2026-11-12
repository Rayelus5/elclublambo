import { TRAITS } from '@galaxy/engine';
import { FINISHES, TIERS, type Tier } from '@galaxy/shared';
import { useId } from 'react';
import { copy, fmt } from '../copy/es';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';

// The collection's filters (GDD §8.5), in two rows: the rarity chips with their counts; then type, palette and finish,
// the favourites and the order. They live in the URL (?tier=rare&sort=rarity…), so a filtered view can be shared,
// reloaded and gone back to.
export interface CollectionFilters {
  tier?: Tier;
  type?: string;
  palette?: string;
  /** A phenomenon, `any` (with one) or `none` (plan «escáner pro», part D: it decides relics most). */
  phenomenon?: string;
  finish?: (typeof FINISHES)[number];
  /** Only favourites (the lock of plan phase 2). */
  locked?: true;
  sort: 'new' | 'rarity';
}

const names = copy.traitValues as Record<string, Record<string, string>>;

/** A phenomenon the engine knows, or `any`. */
export const validPhenomenon = (v: string | null): boolean => !!v && (v === 'any' || TRAITS.traits.phenomenon.values.some((x) => x.value === v));

export function readFilters(params: URLSearchParams): CollectionFilters {
  const tier = params.get('tier');
  const finish = params.get('finish');
  const valid = (key: 'galaxy_type' | 'palette', v: string | null) => (v && TRAITS.traits[key].values.some((x) => x.value === v) ? v : undefined);
  return {
    ...(tier && (TIERS as readonly string[]).includes(tier) ? { tier: tier as Tier } : {}),
    ...(valid('galaxy_type', params.get('type')) ? { type: params.get('type')! } : {}),
    ...(valid('palette', params.get('palette')) ? { palette: params.get('palette')! } : {}),
    ...(validPhenomenon(params.get('phenomenon')) ? { phenomenon: params.get('phenomenon')! } : {}),
    ...(finish && (FINISHES as readonly string[]).includes(finish) ? { finish: finish as CollectionFilters['finish'] } : {}),
    // ?candado=1 was its address before it became favourites.
    ...(params.get('favoritas') === '1' || params.get('candado') === '1' ? { locked: true as const } : {}),
    sort: params.get('sort') === 'rarity' ? 'rarity' : 'new',
  };
}

export function writeFilters(f: CollectionFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.tier) p.set('tier', f.tier);
  if (f.type) p.set('type', f.type);
  if (f.palette) p.set('palette', f.palette);
  if (f.phenomenon) p.set('phenomenon', f.phenomenon);
  if (f.finish) p.set('finish', f.finish);
  if (f.locked) p.set('favoritas', '1');
  if (f.sort === 'rarity') p.set('sort', 'rarity');
  return p;
}

/** The phenomenon filter's choices: with one, without, then each (the engine's own, with their Spanish names). */
export function phenomenonOptions(): [string, string][] {
  const each = TRAITS.traits.phenomenon.values.filter((v) => v.value !== 'none').map((v): [string, string] => [v.value, names['phenomenon']?.[v.value] ?? v.value]);
  return [['any', copy.collection.phenomenonAny], ['none', copy.collection.phenomenonNone], ...each];
}

/** A filter with its visible label and «Cualquiera» first (the game's own dropdown). */
export function FilterSelect({ label, value, options, onChange }: { label: string; value: string | undefined; options: [string, string][]; onChange: (v: string | undefined) => void }) {
  const id = useId();
  return (
    <div className="filter-select">
      <label htmlFor={id}>{label}</label>
      <Select
        id={id}
        size="sm"
        value={value ?? ''}
        options={[{ value: '', label: copy.collection.any }, ...options.map(([v, text]) => ({ value: v, label: text }))]}
        onChange={(v) => onChange(v || undefined)}
      />
    </div>
  );
}

export function Filters({
  filters,
  counts,
  onChange,
}: {
  filters: CollectionFilters;
  counts: Record<Tier, number> | undefined;
  onChange: (next: CollectionFilters) => void;
}) {
  const total = counts ? TIERS.reduce((n, t) => n + counts[t], 0) : undefined;
  const set = (patch: Partial<CollectionFilters>) => onChange({ ...filters, ...patch });
  const options = (key: 'galaxy_type' | 'palette') => TRAITS.traits[key].values.map((v): [string, string] => [v.value, names[key]?.[v.value] ?? v.value]);
  return (
    <div className="filters" role="group" aria-label={copy.collection.filters}>
      <div className="chips">
        <button type="button" className="chip" aria-pressed={!filters.tier} onClick={() => set({ tier: undefined })}>
          {copy.collection.all}
          {total === undefined ? null : <small>{fmt(total)}</small>}
        </button>
        {[...TIERS].reverse().map((t) => (
          <button key={t} type="button" className="chip" data-tier={t} aria-pressed={filters.tier === t} onClick={() => set({ tier: filters.tier === t ? undefined : t })}>
            <i aria-hidden="true" />
            {copy.tiers[t]}
            {counts ? <small>{fmt(counts[t])}</small> : null}
          </button>
        ))}
      </div>
      <div className="filters-row">
        <FilterSelect label={copy.traitNames['galaxy_type']!} value={filters.type} options={options('galaxy_type')} onChange={(type) => set({ type })} />
        <FilterSelect label={copy.traitNames['palette']!} value={filters.palette} options={options('palette')} onChange={(palette) => set({ palette })} />
        <FilterSelect label={copy.traitNames['phenomenon']!} value={filters.phenomenon} options={phenomenonOptions()} onChange={(phenomenon) => set({ phenomenon })} />
        <FilterSelect
          label={copy.finishLabel}
          value={filters.finish}
          options={FINISHES.map((f): [string, string] => [f, copy.finishes[f]])}
          onChange={(finish) => set({ finish: finish as CollectionFilters['finish'] })}
        />
        <button type="button" className="chip fav-chip" aria-pressed={!!filters.locked} onClick={() => set({ locked: filters.locked ? undefined : true })}>
          <Icon name={filters.locked ? 'starOn' : 'star'} />
          {copy.collection.lockedFilter}
        </button>
        <div className="segmented filters-sort" role="group" aria-label={copy.collection.order}>
          <button type="button" aria-pressed={filters.sort === 'new'} onClick={() => set({ sort: 'new' })}>
            {copy.collection.sortNew}
          </button>
          <button type="button" aria-pressed={filters.sort === 'rarity'} onClick={() => set({ sort: 'rarity' })}>
            {copy.collection.sortRarity}
          </button>
        </div>
      </div>
    </div>
  );
}
