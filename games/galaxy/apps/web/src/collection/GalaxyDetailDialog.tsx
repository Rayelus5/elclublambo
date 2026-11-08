import type { GalaxyDetail } from '@galaxy/shared';
import { useId, useState } from 'react';
import { useDisintegrate, useGacha, useGalaxyDetail, useLevelUpGalaxy } from '../api/economy';
import { errorText } from '../auth/useMe';
import { CardBack } from '../cards/CardBack';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy } from '../copy/es';
import { Inspector } from '../inspector/Inspector';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { Link } from 'react-router';

// A galaxy up close (GDD §8.1, §8.5): front and back side by side, where it came from, what it is worth in dust, its
// lineage if it was fused, and Desintegrar — always behind a confirmation that says what it pays.
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
function RelicLevel({ g }: { g: GalaxyDetail }) {
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
            disabled={short === null || short > 0 || up.isPending || g.listed === true}
            aria-busy={up.isPending || undefined}
            aria-describedby={short !== null && short > 0 ? missing : undefined}
            onClick={() => up.mutate({ id: g.id, level: g.level + 1 })}
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
  const [confirming, setConfirming] = useState(false);
  const [inspecting, setInspecting] = useState(false);
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
  const held = g.equipped ? copy.collection.equippedReason : g.exhibited ? copy.planetarium.exhibitedReason : g.listed ? copy.market.listedReason : null;

  return (
    <>
      <Dialog title={g.name} onClose={onClose} className="detail">
        <button type="button" className="lip iconbtn modal-close" onClick={onClose} aria-label={copy.collection.close}>
          <Icon name="close" />
        </button>
        <div className="detail-body">
          <div className="detail-cards">
            <GalaxyCard galaxy={g} size={250} interactive />
            <CardBack galaxy={g} size={250} />
          </div>
          <div className="detail-side">
            <p className="detail-desig">{g.designation}</p>
            <Info g={g} />
            <RelicLevel g={g} />
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
              <button type="button" className="lip pill pill-solar" onClick={() => setInspecting(true)}>
                <Icon name="cube" />
                <span>{copy.inspector.open}</span>
              </button>
              {held === null ? (
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

