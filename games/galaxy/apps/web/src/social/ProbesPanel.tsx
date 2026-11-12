import { PROBE_SHOWCASE_MAX, type Profile, type ProfileProbe } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { useState } from 'react';
import { useSaveProfileProbes } from '../api/social';
import { probeDrawing, spriteDataUrl } from '../arena/sprites';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { useReducedMotion } from '../ui/motion';
import { SpriteLoop } from '../ui/SpriteLoop';

// «Sondas» on a profile (plan «banda sonora, skins, perfil y entorno», part D): the up to three probes the owner shows,
// big and moving with their skins, their level and their starting weapon; below, every probe they have with its level.
// On my own profile, «Elegir sondas» picks the showcase.

const t = copy.social.probes;
const defOf = (id: string) => DEFAULT_CONTENT.probes.find((p) => p.id === id);
const nameOf = (id: string) => defOf(id)?.name ?? id;
const spriteOf = (p: ProfileProbe) => probeDrawing(p.skin, defOf(p.id)?.sprite ?? 'probe-lumen');
const weaponOf = (p: ProfileProbe) => {
  const id = p.variant ?? defOf(p.id)?.weapon ?? '';
  return DEFAULT_CONTENT.weapons.find((w) => w.id === id)?.name ?? id;
};

export function ProbesPanel({ probes, mine }: { probes: NonNullable<Profile['probes']>; mine: boolean }) {
  const reduced = useReducedMotion();
  const [choosing, setChoosing] = useState(false);
  return (
    <section className="lip panel profile-panel profile-probes" aria-labelledby="profile-probes-title">
      <div className="profile-probes-head">
        <h2 id="profile-probes-title">{t.title}</h2>
        {mine && probes.all.length > 0 ? (
          <button type="button" className="lip pill small" aria-haspopup="dialog" onClick={() => setChoosing(true)}>
            <Icon name="starOn" />
            <span>{t.choose}</span>
          </button>
        ) : null}
      </div>
      {probes.showcase.length > 0 ? (
        <ul className="probe-showcase" aria-label={t.showcase}>
          {probes.showcase.map((p) => (
            <li key={p.id} className="probe-showcase-item">
              <SpriteLoop className="probe-showcase-art" id={spriteOf(p)} scale={4} reduced={reduced} width={96} height={96} />
              <b>{nameOf(p.id)}</b>
              <span className="probe-showcase-level">{t.level(p.level)}</span>
              <small>{weaponOf(p)}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="profile-empty">{mine ? t.emptyMine : t.empty}</p>
      )}
      {probes.all.length > 0 ? (
        <ul className="probe-roster" aria-label={mine ? t.allMine : t.all}>
          {probes.all.map((p) => (
            <li key={p.id}>
              <img src={spriteDataUrl(spriteOf(p), 2)} alt="" width={48} height={48} />
              <span>
                <b>{nameOf(p.id)}</b>
                <small>{t.level(p.level)}</small>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {choosing ? <ShowcaseDialog probes={probes} onClose={() => setChoosing(false)} /> : null}
    </section>
  );
}

/** Up to three of my probes, in the order they are ticked. */
function ShowcaseDialog({ probes, onClose }: { probes: NonNullable<Profile['probes']>; onClose: () => void }) {
  const save = useSaveProfileProbes();
  const [chosen, setChosen] = useState<string[]>(probes.showcase.map((p) => p.id));
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length < PROBE_SHOWCASE_MAX ? [...c, id] : c));
  return (
    <Dialog title={t.chooserTitle} onClose={onClose} className="probe-chooser">
      <p className="probe-chooser-hint">{t.chooserHint(PROBE_SHOWCASE_MAX)}</p>
      <fieldset className="probe-chooser-list">
        <legend className="sr-only">{t.chooserTitle}</legend>
        {probes.all.map((p) => {
          const at = chosen.indexOf(p.id);
          const full = at < 0 && chosen.length >= PROBE_SHOWCASE_MAX;
          return (
            <label key={p.id} className={`probe-chooser-item${at >= 0 ? ' on' : ''}${full ? ' full' : ''}`}>
              <input type="checkbox" checked={at >= 0} disabled={full} onChange={() => toggle(p.id)} />
              <img src={spriteDataUrl(spriteOf(p), 2)} alt="" width={48} height={48} />
              <span>
                <b>{nameOf(p.id)}</b>
                <small>{t.level(p.level)}</small>
              </span>
              {at >= 0 ? <span className="probe-chooser-order" aria-hidden="true">{at + 1}</span> : null}
            </label>
          );
        })}
      </fieldset>
      <p className="probe-chooser-count" role="status">
        {t.count(chosen.length, PROBE_SHOWCASE_MAX)}
      </p>
      {save.error ? (
        <p className="field-error" role="alert">
          {errorText(save.error, copy.errors)}
        </p>
      ) : null}
      <div className="modal-actions">
        <button type="button" className="lip pill" onClick={onClose}>
          {t.cancel}
        </button>
        <button type="button" className="lip pill pill-solar" disabled={save.isPending} onClick={() => save.mutate(chosen, { onSuccess: onClose })}>
          {t.save}
        </button>
      </div>
    </Dialog>
  );
}
