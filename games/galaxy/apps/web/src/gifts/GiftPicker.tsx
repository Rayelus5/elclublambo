import type { Gift } from '@galaxy/shared';
import { type KeyboardEvent, useId, useRef, useState } from 'react';
import { copy } from '../copy/es';
import { CosmeticGallery } from './CosmeticGallery';
import { GalaxyBuilder } from './GalaxyBuilder';
import { AmountRow, PacksPanel, ProbePicker } from './panels';
import type { GiftCatalog } from './words';

// The panel's gift picker (mail v2, P3; DESIGN_SYSTEM «Regalos y packs»): every kind of gift by tabs — resources,
// style, galaxies, probes, progress and the pack library — each added with its own control into the message's tray.
// The tabs follow the WAI-ARIA pattern: only the open one takes Tab, the arrows move and open the next, Home and End
// the ends. A full tray says so where the button is.

const g = copy.gifts;
const ALL_TABS = ['resources', 'style', 'galaxies', 'probes', 'progress', 'packs'] as const;
type Tab = (typeof ALL_TABS)[number];

export interface GiftPickerProps {
  catalog: GiftCatalog;
  onAdd: (gift: Gift) => void;
  onAddPack: (id: string) => void;
  /** The packs already in the message (each goes once). */
  packsChosen: readonly string[];
  itemsFull: boolean;
  packsFull: boolean;
  /** Without the packs tab (a pack holds no packs). */
  showPacks?: boolean;
  /** Without season points (a season's own prizes never give them: points that pay steps that pay points). */
  showSeasonPoints?: boolean;
}

export function GiftPicker({ catalog, onAdd, onAddPack, packsChosen, itemsFull, packsFull, showPacks = true, showSeasonPoints = true }: GiftPickerProps) {
  const ids = useId();
  const TABS: readonly Tab[] = showPacks ? ALL_TABS : ALL_TABS.filter((k) => k !== 'packs');
  const [tab, setTab] = useState<Tab>('resources');
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = TABS.indexOf(tab);
  const onKey = (e: KeyboardEvent) => {
    const to = e.key === 'ArrowRight' ? index + 1 : e.key === 'ArrowLeft' ? index - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const n = (to + TABS.length) % TABS.length;
    setTab(TABS[n]!);
    refs.current[n]?.focus();
  };
  const full = itemsFull ? (
    <p className="gift-full" role="status">
      {g.tray.full}
    </p>
  ) : null;
  const currencies = [
    'coins',
    'dust',
    'signal',
    'material',
    'components',
    ...catalog.events.map((e) => `signal:${e.id}`),
    ...(catalog.season.open ? [`season:${catalog.season.id}`] : []),
  ];
  return (
    <section className="gift-picker" aria-label={g.tabsLabel}>
      <div className="tabs admin-tabs gift-tabs" role="tablist" aria-label={g.tabsLabel}>
        {TABS.map((k, i) => (
          <button
            key={k}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${ids}-tab-${k}`}
            type="button"
            role="tab"
            aria-selected={k === tab}
            aria-controls={`${ids}-panel`}
            tabIndex={k === tab ? 0 : -1}
            onKeyDown={onKey}
            onClick={() => setTab(k)}
          >
            {g.tabs[k]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${ids}-panel`} aria-labelledby={`${ids}-tab-${tab}`} className="gift-panel">
        {tab === 'resources' ? (
          <>
            {full}
            <ul className="gift-rows">
              {currencies.map((c) => (
                <AmountRow key={c} gift={(n) => ({ kind: 'currency', currency: c as never, amount: n })} catalog={catalog} max={10_000_000} disabled={itemsFull} onAdd={onAdd} />
              ))}
            </ul>
            <p className="hint">{g.resourcesHint}</p>
          </>
        ) : null}
        {tab === 'style' ? (
          <>
            {full}
            <CosmeticGallery catalog={catalog} disabled={itemsFull} onAdd={onAdd} />
          </>
        ) : null}
        {tab === 'galaxies' ? (
          <>
            {full}
            <GalaxyBuilder disabled={itemsFull} onAdd={onAdd} />
          </>
        ) : null}
        {tab === 'probes' ? (
          <>
            {full}
            <ProbePicker catalog={catalog} disabled={itemsFull} onAdd={onAdd} />
          </>
        ) : null}
        {tab === 'progress' ? (
          <>
            {full}
            <ul className="gift-rows">
              <AmountRow gift={(n) => ({ kind: 'xp', amount: n })} label={g.progress.xp} catalog={catalog} max={1_000_000} disabled={itemsFull} onAdd={onAdd} />
              {showSeasonPoints ? (
                <AmountRow
                  gift={(n) => ({ kind: 'seasonPoints', amount: n })}
                  label={g.progress.seasonPoints}
                  catalog={catalog}
                  max={1_000_000}
                  disabled={itemsFull || !catalog.season.open}
                  note={catalog.season.open ? null : g.progress.seasonClosed}
                  onAdd={onAdd}
                />
              ) : null}
            </ul>
          </>
        ) : null}
        {tab === 'packs' ? <PacksPanel catalog={catalog} chosen={packsChosen} full={packsFull} onAdd={onAddPack} /> : null}
      </div>
    </section>
  );
}
