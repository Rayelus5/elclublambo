import { CLAN_COLORS, CLAN_EMBLEMS, type ClanColor, type ClanEmblem as Emblem } from '@galaxy/shared';
import { type FormEvent, useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { useCreateClan } from '../api/clans';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';
import { ClanEmblem } from './ClanEmblem';

// Creating a clan (GDD §14.3; DESIGN_SYSTEM §8 duodecies): name, tag, description with its count, the emblem and the
// colour chosen in grids of radios (each with its name), open or closed, and the cost before sending.

const t = copy.clans;

export function EmblemPicker({ emblem, color, onEmblem, onColor }: { emblem: Emblem; color: ClanColor; onEmblem: (e: Emblem) => void; onColor: (c: ClanColor) => void }) {
  const emblemTitle = useId();
  const colorTitle = useId();
  return (
    <>
      <div className="clan-pick" role="radiogroup" aria-labelledby={emblemTitle}>
        <span className="clan-pick-title" id={emblemTitle}>
          {t.emblem}
        </span>
        {CLAN_EMBLEMS.map((e) => (
          <label key={e} className="clan-pick-item">
            <input type="radio" name="clan-emblem" value={e} checked={emblem === e} onChange={() => onEmblem(e)} />
            <ClanEmblem emblem={e} color={color} scale={1} />
            <span>{t.emblems[e]}</span>
          </label>
        ))}
      </div>
      <div className="clan-pick" role="radiogroup" aria-labelledby={colorTitle}>
        <span className="clan-pick-title" id={colorTitle}>
          {t.color}
        </span>
        {CLAN_COLORS.map((c) => (
          <label key={c} className="clan-pick-item">
            <input type="radio" name="clan-color" value={c} checked={color === c} onChange={() => onColor(c)} />
            <ClanEmblem emblem={emblem} color={c} scale={1} />
            <span>{t.colors[c]}</span>
          </label>
        ))}
      </div>
    </>
  );
}

export function CreateClanDialog({ cost, onClose }: { cost: number; onClose: () => void }) {
  const create = useCreateClan();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [description, setDescription] = useState('');
  const [emblem, setEmblem] = useState<Emblem>('shield');
  const [color, setColor] = useState<ClanColor>('solar');
  const [open, setOpen] = useState(true);
  const ids = { name: useId(), tag: useId(), tagHint: useId(), description: useId(), access: useId() };

  function submit(e: FormEvent): void {
    e.preventDefault();
    create.mutate(
      { name: name.trim().replace(/\s+/g, ' '), tag: tag.trim().toUpperCase(), description: description.trim(), emblem, color, open },
      { onSuccess: (view) => navigate(`/clanes/${view.tag}`) },
    );
  }

  return (
    <Dialog title={t.createTitle} onClose={onClose} className="clan-create">
      <form className="clan-form" onSubmit={submit}>
        <div className="clan-form-row">
          <label htmlFor={ids.name}>{t.name}</label>
          <input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} maxLength={24} required autoComplete="off" />
        </div>
        <div className="clan-form-row">
          <label htmlFor={ids.tag}>{t.tag}</label>
          <input id={ids.tag} value={tag} onChange={(e) => setTag(e.target.value.toUpperCase())} maxLength={4} required autoComplete="off" aria-describedby={ids.tagHint} className="clan-tag-input" />
          <small id={ids.tagHint}>{t.tagHint}</small>
        </div>
        <div className="clan-form-row">
          <label htmlFor={ids.description}>{t.description}</label>
          <textarea id={ids.description} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={140} rows={2} />
          <small aria-live="polite">{t.count(description.length, 140)}</small>
        </div>
        <EmblemPicker emblem={emblem} color={color} onEmblem={setEmblem} onColor={setColor} />
        <div className="clan-pick" role="radiogroup" aria-labelledby={ids.access}>
          <span className="clan-pick-title" id={ids.access}>
            {t.access}
          </span>
          <label className="clan-access">
            <input type="radio" name="clan-access" checked={open} onChange={() => setOpen(true)} />
            <span>
              <b>{t.open}</b>
              <small>{t.openHint}</small>
            </span>
          </label>
          <label className="clan-access">
            <input type="radio" name="clan-access" checked={!open} onChange={() => setOpen(false)} />
            <span>
              <b>{t.closed}</b>
              <small>{t.closedHint}</small>
            </span>
          </label>
        </div>
        {create.error ? (
          <p className="field-error" role="alert">
            {errorText(create.error, copy.errors)}
          </p>
        ) : null}
        <div className="clan-form-actions">
          <p className="clan-cost">{t.cost(cost)}</p>
          <button type="button" className="lip pill" onClick={onClose}>
            {t.cancel}
          </button>
          <button type="submit" className="lip pill pill-solar" disabled={create.isPending} aria-busy={create.isPending || undefined}>
            {t.submit}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
