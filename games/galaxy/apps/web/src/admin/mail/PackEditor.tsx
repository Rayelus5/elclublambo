import { type Gift, giftIssues, type MailPack, PACK_ARTS, type PackArt as Art } from '@galaxy/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { copy } from '../../copy/es';
import { GiftPicker } from '../../gifts/GiftPicker';
import { GiftTray } from '../../gifts/GiftTray';
import { PackArt } from '../../gifts/PackArt';
import type { GiftCatalog } from '../../gifts/words';
import { Switch } from '../../ui/Switch';

// One pack of the library (mail v2, P4): its name, its id (made from the name; fixed once it exists, since messages
// and templates name it), its art, whether it is on, and what it gives — chosen with the same picker as a message,
// without packs (a pack holds no packs), from 1 to 30 gifts.

const t = copy.admin.packs;
const MAX = 30;

/** «Veterano del vacío» → «veterano-del-vacio». */
export function packSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
}

export function PackEditor({
  pack,
  isNew,
  taken,
  catalog,
  onSave,
  onCancel,
}: {
  pack: MailPack;
  isNew: boolean;
  /** The other packs' ids. */
  taken: readonly string[];
  catalog: GiftCatalog;
  onSave: (pack: MailPack) => void;
  onCancel: () => void;
}) {
  const ids = useId();
  const [name, setName] = useState(pack.name);
  const [id, setId] = useState(pack.id);
  const [idTouched, setIdTouched] = useState(!isNew);
  const [art, setArt] = useState<Art>(pack.art);
  const [enabled, setEnabled] = useState(pack.enabled);
  const [items, setItems] = useState<Gift[]>(pack.items);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  const issues = giftIssues(items, catalog.live);
  const clash = taken.includes(id);
  const ready = name.trim().length > 0 && /^[a-z0-9-]{1,32}$/.test(id) && !clash && items.length > 0 && issues.length === 0;
  return (
    <section className="lip panel pack-editor" aria-label={t.editorTitle}>
      <div className="pack-editor-head">
        <PackArt art={art} className="pack-editor-art" />
        <div className="pack-editor-names">
          <div className="field">
            <label htmlFor={`${ids}-name`}>{t.name}</label>
            <div className="control">
              <input
                ref={first}
                id={`${ids}-name`}
                type="text"
                maxLength={40}
                autoComplete="off"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!idTouched) setId(packSlug(e.target.value));
                }}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor={`${ids}-id`}>{t.id}</label>
            <div className="control">
              <input
                id={`${ids}-id`}
                type="text"
                maxLength={32}
                autoComplete="off"
                readOnly={!isNew}
                aria-describedby={`${ids}-idh`}
                value={id}
                onChange={(e) => {
                  setIdTouched(true);
                  setId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                }}
              />
            </div>
            <p className={clash ? 'field-error' : 'hint'} id={`${ids}-idh`}>
              {clash ? t.idTaken : t.idHint}
            </p>
          </div>
        </div>
        <div className="field pack-editor-on">
          <span className="field-label" id={`${ids}-on`}>
            {t.enabled}
          </span>
          <Switch aria-labelledby={`${ids}-on`} aria-describedby={`${ids}-onh`} checked={enabled} onChange={setEnabled} />
          <p className="hint" id={`${ids}-onh`}>
            {t.enabledHint}
          </p>
        </div>
      </div>
      <fieldset className="pack-arts">
        <legend>{t.art}</legend>
        {PACK_ARTS.map((a) => (
          <label key={a} className="pack-art-choice">
            <input type="radio" name={`${ids}-art`} value={a} checked={art === a} onChange={() => setArt(a)} />
            <PackArt art={a} />
            <span>{t.arts[a]}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="comms-gifts">
        <legend>{t.contents}</legend>
        <p className="hint">{t.contentsHint}</p>
        <GiftTray items={items} packs={[]} catalog={catalog} issues={issues} maxItems={MAX} maxPacks={0} onRemove={(i) => setItems((x) => x.filter((_, k) => k !== i))} onRemovePack={() => {}} />
        <GiftPicker
          catalog={catalog}
          showPacks={false}
          packsChosen={[]}
          itemsFull={items.length >= MAX}
          packsFull
          onAdd={(gift) => setItems((x) => (x.length >= MAX ? x : [...x, gift]))}
          onAddPack={() => {}}
        />
        {issues.length > 0 ? (
          <p className="field-error" role="alert">
            {t.issues}
          </p>
        ) : null}
      </fieldset>
      <div className="pack-editor-actions">
        <button type="button" className="lip pill pill-solar" disabled={!ready} onClick={() => onSave({ id, name: name.trim(), art, enabled, items })}>
          {t.save}
        </button>
        <button type="button" className="lip pill" onClick={onCancel}>
          {t.cancel}
        </button>
      </div>
    </section>
  );
}
