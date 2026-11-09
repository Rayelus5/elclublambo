import { type AutoFusionCriteria, FINISHES, SPECIAL_FINISHES, type Tier, TIERS } from '@galaxy/shared';
import { type CSSProperties, useState } from 'react';
import { useAutoFuse, useAutoFusionPreview } from '../api/economy';
import { errorText } from '../auth/useMe';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy, fmt } from '../copy/es';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import type { CollectionFilters } from './Filters';
import { playFusion } from './sfx';

// The automatic fusion (multiplayer plan, phase 2): from a tier up to a top one, in a chain, for players with a bulk
// of galaxies. It starts from the collection's filters (the rarity chip picks where it starts; type, palette and
// finish narrow what it takes), shows what it would do before doing anything, and keeps by default what a player
// usually wants to keep. Locked, equipped, exhibited, listed and swapped galaxies are never touched.

const t = copy.collection.auto;
type From = AutoFusionCriteria['from'];
type UpTo = AutoFusionCriteria['upTo'];
const FROM: From[] = ['common', 'uncommon', 'rare', 'epic'];
const next = (tier: Tier) => TIERS[Math.min(TIERS.length - 1, TIERS.indexOf(tier) + 1)] as UpTo;

export function AutoFusionDialog({ filters, count, onClose, onDone }: { filters: CollectionFilters; count: number; onClose: () => void; onDone: (message: string) => void }) {
  const start: From = filters.tier && filters.tier !== 'legendary' ? filters.tier : 'common';
  const [from, setFrom] = useState<From>(start);
  const [upTo, setUpTo] = useState<UpTo>(next(start));
  // Filtering by a special finish means fusing that finish: it is not kept then.
  const [keepFinishes, setKeepFinishes] = useState(!(filters.finish && SPECIAL_FINISHES.includes(filters.finish)));
  const [keepLeveled, setKeepLeveled] = useState(true);
  const criteria: AutoFusionCriteria = {
    from,
    upTo,
    keepFinishes,
    keepLeveled,
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.palette ? { palette: filters.palette } : {}),
    ...(filters.finish ? { finish: filters.finish } : {}),
  };
  const fuse = useAutoFuse();
  const preview = useAutoFusionPreview(criteria, !fuse.data);
  const p = preview.data;
  const result = fuse.data;

  function pickFrom(v: From): void {
    setFrom(v);
    if (TIERS.indexOf(upTo) <= TIERS.indexOf(v)) setUpTo(next(v));
  }

  function close(): void {
    if (result) onDone(t.done(result.fusions, result.galaxies.length));
    onClose();
  }

  const narrowed = [
    filters.type ? (copy.traitValues as unknown as Record<string, Record<string, string>>)['galaxy_type']?.[filters.type] ?? filters.type : null,
    filters.palette ? (copy.traitValues as unknown as Record<string, Record<string, string>>)['palette']?.[filters.palette] ?? filters.palette : null,
    filters.finish ? copy.finishes[filters.finish as (typeof FINISHES)[number]] : null,
  ].filter((x): x is string => !!x);

  if (result) {
    const shown = result.galaxies.slice(0, 12);
    return (
      <Dialog title={t.doneTitle} onClose={close} className="auto-fusion">
        <p className="af-lead">{t.doneBody(result.fusions, result.galaxies.length, result.dust)}</p>
        {shown.length > 0 ? (
          <ul className="af-made" aria-label={t.madeLabel}>
            {shown.map((g, i) => (
              <li key={g.id} className="af-pop" style={{ '--i': i } as CSSProperties}>
                <GalaxyCard galaxy={g} size={124} />
              </li>
            ))}
          </ul>
        ) : null}
        {result.galaxies.length > shown.length ? <p className="af-note">{t.andMore(result.galaxies.length - shown.length)}</p> : null}
        <div className="af-actions">
          {result.more ? (
            <button type="button" className="lip pill pill-solar" onClick={() => fuse.reset()}>
              <Icon name="fuse" />
              <span>{t.keepGoing}</span>
            </button>
          ) : null}
          <button type="button" className="lip pill" onClick={close} data-autofocus>
            {copy.collection.close}
          </button>
        </div>
      </Dialog>
    );
  }

  const kept = p ? (Object.entries(p.kept) as [keyof typeof p.kept, number][]).filter(([, n]) => n > 0) : [];
  return (
    <Dialog title={t.title} onClose={onClose} className="auto-fusion">
      <p className="af-lead">{t.lead(count)}</p>
      <div className="af-range">
        <label>
          <span>{t.from}</span>
          <select value={from} onChange={(e) => pickFrom(e.target.value as From)} data-autofocus>
            {FROM.map((tier) => (
              <option key={tier} value={tier}>
                {copy.tiers[tier]}
              </option>
            ))}
          </select>
        </label>
        <Icon name="fuse" />
        <label>
          <span>{t.upTo}</span>
          <select value={upTo} onChange={(e) => setUpTo(e.target.value as UpTo)}>
            {TIERS.filter((tier) => TIERS.indexOf(tier) > TIERS.indexOf(from)).map((tier) => (
              <option key={tier} value={tier}>
                {copy.tiers[tier]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {narrowed.length > 0 ? <p className="af-note">{t.narrowed(narrowed)}</p> : null}
      <div className="af-keep" role="group" aria-label={t.keepTitle}>
        <label className="check">
          <input type="checkbox" checked={keepFinishes} onChange={(e) => setKeepFinishes(e.target.checked)} />
          <span>{t.keepFinishes}</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={keepLeveled} onChange={(e) => setKeepLeveled(e.target.checked)} />
          <span>{t.keepLeveled}</span>
        </label>
        <p className="af-note">{t.always}</p>
      </div>

      <section className="lip panel af-plan" aria-live="polite" aria-busy={preview.isFetching || undefined}>
        <h3>{t.planTitle}</h3>
        {preview.isError ? (
          <p className="summary error" role="alert">
            <Icon name="alert" />
            <span>{errorText(preview.error, copy.errors)}</span>
          </p>
        ) : !p ? (
          <p className="af-note" aria-hidden="true">
            ⠋⠙⠹
          </p>
        ) : p.fusions === 0 ? (
          <p className="af-empty">{p.short ? t.noDust : t.nothing}</p>
        ) : (
          <>
            <ol className="af-steps">
              {p.steps.map((s) => (
                <li key={s.from}>
                  <span className="af-tiers">
                    <i data-tier={s.from} aria-hidden="true" />
                    {copy.tiers[s.from]}
                    <span aria-hidden="true"> → </span>
                    <i data-tier={s.to} aria-hidden="true" />
                    {copy.tiers[s.to]}
                  </span>
                  <span>{t.stepCount(s.fusions)}</span>
                  <span className="af-dust">
                    <Icon name="dust" />
                    {fmt(s.dust)}
                  </span>
                </li>
              ))}
            </ol>
            <p className="af-total">{t.total(p.fusions, p.dust, p.wallet - p.dust)}</p>
            {p.steps.length > 1 ? <p className="af-note">{t.upperBound}</p> : null}
            {p.short ? <p className="af-warn">{t.short}</p> : null}
            {p.limited ? <p className="af-note">{t.limited}</p> : null}
          </>
        )}
        {kept.length > 0 ? <p className="af-note">{t.kept(kept.map(([why, n]) => t.keptWhy[why](n)))}</p> : null}
      </section>

      {fuse.isError ? (
        <p className="summary error" role="alert">
          <Icon name="alert" />
          <span>{errorText(fuse.error, copy.errors)}</span>
        </p>
      ) : null}
      <div className="af-actions">
        <button type="button" className="lip pill" onClick={onClose}>
          {copy.collection.cancel}
        </button>
        <button type="button" className="lip pill pill-solar" disabled={!p || p.fusions === 0 || fuse.isPending} aria-busy={fuse.isPending || undefined} onClick={() => fuse.mutate(criteria, { onSuccess: (r) => (r.fusions > 0 ? playFusion() : undefined) })}>
          <Icon name="fuse" />
          <span>{p && p.fusions > 0 ? t.confirm(p.fusions) : t.confirmNone}</span>
        </button>
      </div>
    </Dialog>
  );
}
