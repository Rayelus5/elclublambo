import type { GalaxyDetail } from '@galaxy/shared';
import { useEffect, useId, useState } from 'react';
import { useDisintegrate, useGacha, useGalaxyDetail, useLevelUpGalaxy, useLock } from '../api/economy';
import { errorText } from '../auth/useMe';
import { CardBack } from '../cards/CardBack';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy } from '../copy/es';
import { Inspector } from '../inspector/Inspector';
import { Dialog } from '../ui/Dialog';
import { Celebration } from '../ui/Celebration';
import { Icon } from '../ui/Icon';
import { useReducedMotion } from '../ui/motion';
import { Link } from 'react-router';
import { playGalaxyLevel } from './sfx';
import { RelicSheet } from '../hangar/RelicSheet';
import { tierSparks } from '../a11y/color-vision';
import { usePrefs } from '../settings/prefs';

// A galaxy up close (GDD §8.1, §8.5): the card big on the left (it turns over to show its back) with the 3D
// inspector under it; on the right, in the order a player looks for them, the favourite star, its level (levelling
// up is celebrated: sparks in its tier's colours, the card glows, the new level and a sound), where it came from and
// what it is worth, its lineage if it was fused, and then selling or disintegrating — always behind a confirmation
// that says what it pays.
const day = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' });

function Info({ g }: { g: GalaxyDetail }) {
  return (
    <dl className="detail-facts">
      <div>
        <dt>{copy.collection.originLabel}</dt>
        <dd>{copy.collection.origin[g.origin]}</dd>
      </div>
      <div>
        <dt>{copy.collection.found}</dt>
        <dd>{day.format(new Date(g.createdAt))}</dd>
      </div>
      <div>
        <dt>{copy.collection.dustValue}</dt>
        <dd>{copy.hub.resource.dust(g.dust)}</dd>
      </div>
      <div>
        <dt>{copy.collection.dna}</dt>
        <dd className="dna" title={g.dna}>
          {g.dna.slice(0, 16)}
        </dd>
      </div>
    </dl>
  );
}

/** Its level (GDD §8.4 bis, M4c-1): «Nivel 3 de 10» with its pips, the next level with its dust and what is missing. */
function RelicLevel({ g, onLeveled }: { g: GalaxyDetail; onLeveled: (level: number) => void }) {
  const up = useLevelUpGalaxy();
  const dust = useGacha().data?.wallet.dust;
  const next = g.levelUp;
  const short = next && dust !== undefined ? Math.max(0, next.dust - dust) : null;
  const missing = useId();
  return (
    <div className="relic-level">
      <div className="probe-level-head">
        <b>{copy.hangar.level(g.level, 10)}</b>
        <span className="level-pips" aria-hidden="true">
          {Array.from({ length: 10 }, (_, i) => (
            <i key={i} className={i < g.level ? 'on' : undefined} />
          ))}
        </span>
      </div>
      {next ? (
        <>
          <button
            type="button"
            className="lip pill pill-solar station-upgrade"
            disabled={short === null || short > 0 || up.isPending || g.listed === true || g.traded === true}
            aria-busy={up.isPending || undefined}
            aria-describedby={short !== null && short > 0 ? missing : undefined}
            onClick={() => up.mutate({ id: g.id, level: g.level + 1 }, { onSuccess: (res) => onLeveled(res.galaxy.level) })}
          >
            <Icon name="dust" />
            <span>{copy.hangar.levelUp(g.level + 1)}</span>
            <small>{copy.collection.levelCost(next.dust)}</small>
          </button>
          {short !== null && short > 0 ? (
            <p className="panel-note" id={missing}>
              {copy.lab.missing(short, 0)}
            </p>
          ) : null}
        </>
      ) : (
        <p className="panel-note">{copy.hangar.levelMax}</p>
      )}
      {g.refund > 0 ? <p className="panel-note">{copy.collection.refund(g.refund)}</p> : null}
      {up.error ? (
        <p className="field-error" role="alert">
          {errorText(up.error, copy.errors)}
        </p>
      ) : null}
    </div>
  );
}

export function GalaxyDetailDialog({ id, onClose, onDisintegrated }: { id: string; onClose: () => void; onDisintegrated: (name: string, dust: number) => void }) {
  const detail = useGalaxyDetail(id);
  const disintegrate = useDisintegrate();
  const lock = useLock();
  const [confirming, setConfirming] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [back, setBack] = useState(false);
  const [celebrate, setCelebrate] = useState<{ level: number; key: number } | null>(null);
  const reduced = useReducedMotion();
  const colorVision = usePrefs((p) => p.colorVision);
  useEffect(() => {
    if (!celebrate) return;
    const t = setTimeout(() => setCelebrate(null), 2600);
    return () => clearTimeout(t);
  }, [celebrate]);
  const g = detail.data;

  if (!g) {
    return (
      <Dialog title={detail.isError ? (errorText(detail.error, copy.errors) ?? copy.errors.internal) : copy.loading} onClose={onClose} className="detail">
        <button type="button" className="lip pill" onClick={onClose}>
          {copy.collection.close}
        </button>
      </Dialog>
    );
  }
  // Why it cannot be disintegrated now: equipped in the hangar, on a pedestal of the planetarium or for sale (M5c-1).
  const held = g.locked
    ? copy.collection.lockedReason
    : g.equipped
      ? copy.collection.equippedReason
      : g.exhibited
        ? copy.planetarium.exhibitedReason
        : g.listed
          ? copy.market.listedReason
          : g.traded
            ? copy.trades.inTradeReason
            : null;

  return (
    <>
      <Dialog title={g.name} onClose={onClose} className="detail">
        <button type="button" className="lip iconbtn modal-close" onClick={onClose} aria-label={copy.collection.close}>
          <Icon name="close" />
        </button>
        <div className="detail-body">
          <div className="detail-stage">
            <div className={`detail-flip${back ? ' back' : ''}${celebrate ? ' leveled' : ''}`} data-tier={g.tier}>
              <div className="detail-face front">
                <GalaxyCard galaxy={g} size={280} interactive>
                  {/* The card opens what it does as a relic (plan «escáner pro», part D). */}
                  <button type="button" className="gcard-hit" aria-label={copy.hangar.sheet.open(g.name)} title={copy.hangar.sheet.open(g.name)} aria-haspopup="dialog" onClick={() => setSheet(true)} />
                </GalaxyCard>
              </div>
              <div className="detail-face rear">
                <CardBack galaxy={g} size={280} />
              </div>
              {celebrate ? <Celebration key={celebrate.key} title={copy.collection.levelBanner(celebrate.level)} subtitle={copy.collection.levelDone} reduced={reduced} hot={tierSparks(g.tier, colorVision)} cold="#bfe3ff" /> : null}
            </div>
            <div className="detail-stage-actions">
              <button type="button" className="lip pill" aria-pressed={back} onClick={() => setBack((b) => !b)}>
                <Icon name="flip" />
                <span>{back ? copy.collection.flipBack : copy.collection.flip}</span>
              </button>
              <button type="button" className="lip pill pill-solar" onClick={() => setInspecting(true)}>
                <Icon name="cube" />
                <span>{copy.inspector.open}</span>
              </button>
            </div>
          </div>
          <div className="detail-side">
            <div className="detail-head">
              <p className="detail-desig">{g.designation}</p>
              <button
                type="button"
                className={g.locked ? 'lip pill fav-toggle on' : 'lip pill fav-toggle'}
                aria-pressed={!!g.locked}
                aria-describedby={g.locked ? undefined : 'fav-hint'}
                disabled={lock.isPending}
                onClick={() => lock.mutate({ id: g.id, locked: !g.locked })}
              >
                <Icon name={g.locked ? 'starOn' : 'star'} />
                <span>{g.locked ? copy.collection.unlock : copy.collection.lock}</span>
              </button>
            </div>
            {/* Once a favourite, the reason under the actions says the same. */}
            {g.locked ? null : (
              <p className="detail-fav-hint" id="fav-hint">
                {copy.collection.favoriteHint}
              </p>
            )}
            <RelicLevel
              g={g}
              onLeveled={(level) => {
                playGalaxyLevel();
                setBack(false);
                setCelebrate({ level, key: Date.now() });
              }}
            />
            <Info g={g} />
            {g.lineage.length > 0 ? (
              <>
                <h3>{copy.collection.lineage}</h3>
                <ul className="lineage" aria-label={copy.collection.lineage}>
                  {g.lineage.map((p) => (
                    <li key={p.id} data-tier={p.tier}>
                      <i aria-hidden="true" />
                      <b>{p.name}</b>
                      <span>{p.designation}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <div className="detail-actions">
              {held === null || g.locked ? (
                <Link to={`/mercado?pestana=vender&galaxia=${g.id}`} className="lip pill">
                  <Icon name="store" />
                  <span>{copy.market.sellIt}</span>
                </Link>
              ) : null}
              <button type="button" className="lip pill danger" onClick={() => setConfirming(true)} disabled={held !== null} aria-describedby={held ? 'held-reason' : undefined}>
                <Icon name="dust" />
                <span>{copy.collection.disintegrate}</span>
              </button>
            </div>
            {held ? (
              <p id="held-reason" className="detail-note">
                {held}
              </p>
            ) : null}
          </div>
        </div>
      </Dialog>
      {inspecting ? <Inspector galaxy={g} onClose={() => setInspecting(false)} /> : null}
      {sheet ? <RelicSheet mode="view" galaxy={g} onClose={() => setSheet(false)} /> : null}
      {confirming ? (
        <Dialog role="alertdialog" title={copy.collection.disintegrateTitle(g.name)} onClose={() => setConfirming(false)} className="confirm">
          <p>{copy.collection.disintegrateBody(g.dust)}</p>
          {disintegrate.isError ? (
            <p className="summary error" role="alert">
              <Icon name="alert" />
              <span>{errorText(disintegrate.error, copy.errors)}</span>
            </p>
          ) : null}
          <div className="confirm-actions">
            <button type="button" className="lip pill" data-autofocus onClick={() => setConfirming(false)}>
              {copy.collection.cancel}
            </button>
            <button
              type="button"
              className="lip pill danger"
              disabled={disintegrate.isPending}
              aria-busy={disintegrate.isPending || undefined}
              onClick={() =>
                disintegrate.mutate(g.id, {
                  onSuccess: (res) => {
                    setConfirming(false);
                    onDisintegrated(g.name, res.dust);
                  },
                })
              }
            >
              {copy.collection.disintegrate}
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

