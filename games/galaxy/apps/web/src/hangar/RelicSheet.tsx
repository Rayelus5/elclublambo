import type { GalaxySummary } from '@galaxy/shared';
import { type ReactNode, useMemo } from 'react';
import { useLiveContent } from '../api/content';
import { copy } from '../copy/es';
import { InspectorView } from '../inspector/Inspector';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { relicSheet } from './relic-sheet';

// The relic sheet (plan «escáner pro», part D; the owner: «al pulsar en una, no se nos debe de equipar directamente,
// sino que se abrirá otra ventana donde se nos explique todas las pasivas/habilidades/potenciadores que tiene dicha
// galaxia, a parte de su previsualización en 3d y un boton de "Equipar"»). The card in 3D on one side; on the other,
// what it does — every power with its number from the live content, its sets, the stacking — and, to equip it, which
// slot it goes to and what it replaces. From the collection it only shows (no «Equipar»).

const h = copy.hangar;
const s = h.sheet;
const KINDS: Partial<Record<string, string>> = h.skillInfo.kinds;

export function RelicSheet({
  galaxy,
  mode,
  loadout,
  slot,
  busy = false,
  onEquip,
  onBack,
  onClose,
  extra,
  actions,
  heading,
}: {
  galaxy: GalaxySummary;
  mode: 'equip' | 'view';
  /** Above its powers (the market's preview: price, seller and until when). */
  extra?: ReactNode;
  /** In place of «Cerrar» (the market's preview: «Comprar»), with «Cerrar» before them. */
  actions?: ReactNode;
  /** Its title, when it is not a relic of one's own (the market's preview: the galaxy's name). */
  heading?: string;
  /** The relics equipped now, by slot (to tell what it does among them). */
  loadout?: readonly (GalaxySummary | null)[];
  /** The slot it would go to. */
  slot?: number;
  busy?: boolean;
  onEquip?: () => void;
  /** Back to the list it was chosen from. */
  onBack?: () => void;
  onClose: () => void;
}) {
  const content = useLiveContent();
  const model = useMemo(() => relicSheet(galaxy, content, mode === 'equip' ? { loadout, slot } : {}), [galaxy, content, mode, loadout, slot]);
  return (
    <Dialog title={heading ?? s.title(galaxy.name)} onClose={onClose} className="relic-sheet">
      <div className="relic-sheet-body">
        <section className="relic-sheet-card" aria-label={s.card}>
          <InspectorView galaxy={galaxy} className="relic-sheet-3d" />
        </section>
        <section className="relic-sheet-info" aria-labelledby="relic-sheet-powers">
          <header className="relic-sheet-head" data-tier={galaxy.tier}>
            <span className="relic-sheet-tier">
              <i aria-hidden="true" />
              {copy.tiers[galaxy.tier]}
              {galaxy.finish !== 'normal' ? <span className="relic-sheet-finish">{copy.finishes[galaxy.finish]}</span> : null}
            </span>
            <span className="relic-sheet-desig">
              {galaxy.designation} · {copy.card.levelShort(galaxy.level)}
            </span>
            {mode === 'equip' && slot !== undefined ? (
              <span className="relic-sheet-slot">
                <Icon name={model.replaces ? 'flip' : 'plus'} />
                {model.replaces ? s.replaces(model.replaces.name) : s.intoSlot(slot + 1)}
              </span>
            ) : null}
          </header>
          {extra}
          <h3 id="relic-sheet-powers">{s.powers}</h3>
          <ul className="skill-list relic-sheet-powers">
            {model.powers.map((p) => (
              <li key={p.kind} className={`skill-row k-${p.kind}${p.kind === 'element' && model.skill.element ? ` is-${model.skill.element}` : ''}`}>
                <span className={`skill-kind k-${p.kind}`}>{KINDS[p.kind] ?? p.name}</span>
                {KINDS[p.kind] ? <b className="skill-name">{p.name}</b> : null}
                <p className="skill-text">{p.text}</p>
                {p.detail ? <p className="skill-extra">{p.detail}</p> : null}
                <p className="skill-from">{p.from}</p>
              </li>
            ))}
          </ul>
          {model.stacking ? (
            <p className="relic-sheet-warn" role="note">
              <Icon name="alert" />
              {s.stacking(model.stacking.count, model.stacking.factor)}
            </p>
          ) : null}
          <h3>{s.sets}</h3>
          {model.sets.length ? (
            <ul className="set-list">
              {model.sets.map((x) => (
                <li key={x.key} className="set-item active">
                  <b>
                    {x.name}
                    {x.fresh ? <span className="relic-sheet-new">{s.setFresh}</span> : null}
                  </b>
                  <span className="set-desc">{x.description}</span>
                  {x.bonus.map((t) => (
                    <span key={t} className="set-bonus">
                      {t}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          ) : (
            <p className="panel-note">{s.setsNone}</p>
          )}
          {model.alone ? <p className="panel-note relic-sheet-alone">{s.alone}</p> : null}
        </section>
      </div>
      <div className="modal-actions">
        {mode === 'equip' ? (
          <>
            <button type="button" className="lip pill" onClick={onBack ?? onClose}>
              <Icon name="back" />
              <span>{s.back}</span>
            </button>
            <button type="button" className="lip pill pill-solar" data-autofocus disabled={busy} aria-busy={busy || undefined} onClick={onEquip}>
              <Icon name="check" />
              <span>{busy ? s.equipping : s.equip}</span>
            </button>
          </>
        ) : (
          <>
            <button type="button" className="lip pill" data-autofocus={actions ? undefined : true} onClick={onClose}>
              {copy.collection.close}
            </button>
            {actions}
          </>
        )}
      </div>
    </Dialog>
  );
}
