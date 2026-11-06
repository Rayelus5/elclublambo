import { TRAITS } from '@galaxy/engine';
import { FINISHES, TIERS, type Tier } from '@galaxy/shared';
import { copy, fmt } from '../copy/es';

// The collection's filters (GDD §8.5): rarity chips with their counts, type, palette and finish, and the order. They
// live in the URL (?tier=rare&sort=rarity…), so a filtered view can be shared, reloaded and gone back to.
export interface CollectionFilters {
  tier?: Tier;
  type?: string;
  palette?: string;
  finish?: (typeof FINISHES)[number];
  sort: 'new' | 'rarity';
}

const names = copy.traitValues as Record<string, Record<string, string>>;

export function readFilters(params: URLSearchParams): CollectionFilters {
  const tier = params.get('tier');
  const finish = params.get('finish');
  const valid = (key: 'galaxy_type' | 'palette', v: string | null) => (v && TRAITS.traits[key].values.some((x) => x.value === v) ? v : undefined);
  return {
    ...(tier && (TIERS as readonly string[]).includes(tier) ? { tier: tier as Tier } : {}),
    ...(valid('galaxy_type', params.get('type')) ? { type: params.get('type')! } : {}),
    ...(valid('palette', params.get('palette')) ? { palette: params.get('palette')! } : {}),
    ...(finish && (FINISHES as readonly string[]).includes(finish) ? { finish: finish as CollectionFilters['finish'] } : {}),
    sort: params.get('sort') === 'rarity' ? 'rarity' : 'new',
  };
}

export function writeFilters(f: CollectionFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.tier) p.set('tier', f.tier);
  if (f.type) p.set('type', f.type);
  if (f.palette) p.set('palette', f.palette);
  if (f.finish) p.set('finish', f.finish);
  if (f.sort === 'rarity') p.set('sort', 'rarity');
  return p;
}

function Select({ label, value, options, onChange }: { label: string; value: string | undefined; options: [string, string][]; onChange: (v: string | undefined) => void }) {
  return (
    <label className="filter-select">
      <span>{label}</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">{copy.collection.any}</option>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
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
      <div className="selects">
        <Select label={copy.traitNames['galaxy_type']!} value={filters.type} options={options('galaxy_type')} onChange={(type) => set({ type })} />
        <Select label={copy.traitNames['palette']!} value={filters.palette} options={options('palette')} onChange={(palette) => set({ palette })} />
        <Select
          label={copy.finishLabel}
          value={filters.finish}
          options={FINISHES.map((f): [string, string] => [f, copy.finishes[f]])}
          onChange={(finish) => set({ finish: finish as CollectionFilters['finish'] })}
        />
        <div className="segmented" role="group" aria-label={copy.collection.order}>
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
