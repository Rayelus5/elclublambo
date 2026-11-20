import type { Gift } from '@galaxy/shared';
import { useId, useState } from 'react';
import { probeDrawing } from '../arena/sprites';
import { copy } from '../copy/es';
import { Link } from 'react-router';
import { Icon } from '../ui/Icon';
import { useReducedMotion } from '../ui/motion';
import { SpriteLoop } from '../ui/SpriteLoop';
import { GiftArt } from './GiftArt';
import { PackArt } from './PackArt';
import { currencyLook, type GiftCatalog, giftWords } from './words';

// The gift picker's simpler tabs (mail v2, P3): an amount of a currency, XP or season points; a probe; a pack of the
// library with what it carries.

const g = copy.gifts;

/** One amount to add: its drawing, its name, the number and «Añadir» (named for what it adds). */
export function AmountRow({
  gift,
  label,
  catalog,
  max,
  disabled,
  note,
  onAdd,
}: {
  gift: (n: number) => Gift;
  label?: string;
  catalog: GiftCatalog;
  max: number;
  disabled: boolean;
  note?: string | null;
  onAdd: (gift: Gift) => void;
}) {
  const id = useId();
  const [value, setValue] = useState('');
  const sample = gift(1);
  const name = label ?? (sample.kind === 'currency' ? currencyLook(sample.currency, catalog).name : '');
  const n = Math.min(max, Number(value) || 0);
  return (
    <li className="gift-row">
      <GiftArt gift={sample} catalog={catalog} />
      <label htmlFor={id} className="gift-row-name">
        {name}
        {note ? <small>{note}</small> : null}
      </label>
      <input id={id} className="gift-row-amount" inputMode="numeric" autoComplete="off" aria-label={g.amountOf(name)} value={value} disabled={disabled} onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, String(max).length))} />
      <button
        type="button"
        className="lip pill small"
        aria-label={g.addOf(name)}
        disabled={disabled || n <= 0}
        onClick={() => {
          onAdd(gift(n));
          setValue('');
        }}
      >
        <Icon name="plus" />
        <span>{g.add}</span>
      </button>
    </li>
  );
}

/** Every probe, flying: one press adds it. */
export function ProbePicker({ catalog, disabled, onAdd }: { catalog: GiftCatalog; disabled: boolean; onAdd: (gift: Gift) => void }) {
  const reduced = useReducedMotion();
  return (
    <>
      <ul className="gift-grid">
        {catalog.probes.map((p) => (
          <li key={p.id}>
            <button type="button" className="gift-card" aria-label={g.addOf(g.probe(p.name))} disabled={disabled} onClick={() => onAdd({ kind: 'probe', probe: p.id })}>
              <SpriteLoop className="gift-card-sprite" id={probeDrawing(null, p.sprite)} scale={2} reduced={reduced} width={48} height={48} />
              <b>{p.name}</b>
            </button>
          </li>
        ))}
      </ul>
      <p className="hint">{g.probesHint}</p>
    </>
  );
}

/** The library's packs (those on): their art, name and what they carry; each goes once in a message. */
export function PacksPanel({ catalog, chosen, full, onAdd }: { catalog: GiftCatalog; chosen: readonly string[]; full: boolean; onAdd: (id: string) => void }) {
  const packs = catalog.packs.filter((p) => p.enabled);
  const library = (
    <Link to="/admin/configuracion/mail" className="lip pill small gift-library-link">
      <Icon name="list" />
      <span>{copy.admin.packs.openLibrary}</span>
    </Link>
  );
  if (packs.length === 0)
    return (
      <>
        <p className="panel-note">{g.packsEmpty}</p>
        {library}
      </>
    );
  return (
    <>
      {full ? (
        <p className="gift-full" role="status">
          {g.tray.packsFull}
        </p>
      ) : null}
      <ul className="gift-packs">
        {packs.map((p) => (
          <li key={p.id} className="gift-pack" data-art={p.art}>
            <PackArt art={p.art} />
            <span className="gift-pack-text">
              <b>{p.name}</b>
              <small>{g.packItems(p.items.length)}</small>
            </span>
            <ul className="gift-pack-strip" aria-label={p.items.map((i) => giftWords(i, catalog)).join(', ')}>
              {p.items.slice(0, 6).map((i, k) => (
                <li key={k}>
                  <GiftArt gift={i} catalog={catalog} compact />
                </li>
              ))}
            </ul>
            <button type="button" className="lip pill small" aria-label={g.addOf(g.pack(p.name))} disabled={full || chosen.includes(p.id)} onClick={() => onAdd(p.id)}>
              <Icon name="plus" />
              <span>{g.add}</span>
            </button>
          </li>
        ))}
      </ul>
      {library}
    </>
  );
}
