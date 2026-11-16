import { type MailPack, parseConfig } from '@galaxy/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useConfigKeys, usePublishConfig } from '../../api/config';
import { copy } from '../../copy/es';
import { GiftArt } from '../../gifts/GiftArt';
import { PackArt } from '../../gifts/PackArt';
import { useGiftCatalog } from '../../gifts/useGiftCatalog';
import { giftWords } from '../../gifts/words';
import { Icon } from '../../ui/Icon';
import { PublishFields } from '../PublishFields';
import { PackEditor } from './PackEditor';

// The mail's pack library (mail v2, P4; the owner: «biblioteca de packs»), the `mail` key's own page in
// Configuración: every pack drawn with what it gives, made and changed visually, kept as unpublished changes until the
// whole key is published with its version (another admin's publish in between answers config_conflict), a reason and
// the password. The templates and the expiry warning travel untouched.

const t = copy.admin.packs;
const g = copy.gifts;
const EMPTY: MailPack = { id: '', name: '', art: 'parcel', enabled: true, items: [] };

/** How many packs differ from what is live: added, removed or changed. */
function changes(draft: readonly MailPack[], live: readonly MailPack[]): number {
  const ids = new Set([...draft.map((p) => p.id), ...live.map((p) => p.id)]);
  let n = 0;
  for (const id of ids) {
    const a = draft.find((p) => p.id === id);
    const b = live.find((p) => p.id === id);
    if (JSON.stringify(a) !== JSON.stringify(b)) n++;
  }
  return n;
}

export function PackLibraryScreen() {
  const keys = useConfigKeys();
  const row = keys.data?.find((k) => k.key === 'mail');
  const live = useMemo(() => (row ? parseConfig('mail', row.data) : null), [row]);
  const { catalog } = useGiftCatalog();
  const publish = usePublishConfig('mail');
  const [draft, setDraft] = useState<MailPack[] | null>(null);
  const [editing, setEditing] = useState<{ index: number | null; pack: MailPack } | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const packs = draft ?? live?.packs ?? [];
  const pending = live ? changes(packs, live.packs) : 0;

  const save = (pack: MailPack) => {
    const next = [...packs];
    if (editing?.index === null || editing?.index === undefined) next.push(pack);
    else next[editing.index] = pack;
    setDraft(next);
    setEditing(null);
    setDone(null);
  };

  return (
    <section className="admin-page pack-lib">
      <Link to="/admin/configuracion" className="lip pill small">
        <Icon name="back" />
        <span>{copy.admin.config.back}</span>
      </Link>
      <h1>{t.title}</h1>
      <p className="panel-note">
        {t.lead}. {row ? copy.admin.config.version(row.version) : null}
      </p>
      {keys.error ? (
        <p className="field-error" role="alert">
          {String(copy.errors.internal)}
        </p>
      ) : null}
      {editing && catalog ? (
        <PackEditor
          key={editing.index ?? 'new'}
          pack={editing.pack}
          isNew={editing.index === null}
          taken={packs.filter((_, i) => i !== editing.index).map((p) => p.id)}
          catalog={catalog}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      {!editing && live && catalog ? (
        <>
          {packs.length === 0 ? <p className="panel-note">{t.empty}</p> : null}
          <ul className="pack-lib-grid">
            {packs.map((p, i) => (
              <li key={p.id} className={`lip panel pack-lib-card${p.enabled ? '' : ' off'}`}>
                <PackArt art={p.art} />
                <div className="pack-lib-text">
                  <h3>{p.name}</h3>
                  <small>{g.packItems(p.items.length)}</small>
                  {p.enabled ? null : <span className="admin-chip">{g.packOff}</span>}
                </div>
                <ul className="gift-pack-strip" aria-label={p.items.map((x) => giftWords(x, catalog)).join(', ')}>
                  {p.items.slice(0, 8).map((x, k) => (
                    <li key={k}>
                      <GiftArt gift={x} catalog={catalog} compact />
                    </li>
                  ))}
                </ul>
                <div className="pack-lib-actions">
                  <button type="button" className="lip pill small" aria-label={t.editOf(p.name)} onClick={() => setEditing({ index: i, pack: p })}>
                    {t.edit}
                  </button>
                  <button type="button" className="lip iconbtn small" aria-label={t.removeOf(p.name)} title={t.removeOf(p.name)} onClick={() => setDraft(packs.filter((_, k) => k !== i))}>
                    <Icon name="trash" />
                  </button>
                </div>
              </li>
            ))}
            <li>
              <button type="button" className="pack-lib-new" onClick={() => setEditing({ index: null, pack: EMPTY })}>
                <Icon name="plus" />
                <span>{t.create}</span>
              </button>
            </li>
          </ul>
          {pending > 0 || publish.error ? (
            <div className="lip panel pack-lib-publish">
              <p className="pack-lib-pending">
                <b>{t.pending(pending)}</b>
                <button type="button" className="lip pill small" onClick={() => setDraft(null)}>
                  {t.discard}
                </button>
              </p>
              <PublishFields
                busy={publish.isPending}
                disabled={pending === 0}
                error={publish.error}
                label={t.publish}
                onPublish={(reason, password) =>
                  publish.mutate(
                    { data: { ...live, packs }, baseVersion: row?.version, reason, password },
                    {
                      onSuccess: (r) => {
                        setDraft(null);
                        setDone(r.version);
                      },
                    },
                  )
                }
              />
            </div>
          ) : null}
          {done !== null ? (
            <p className="admin-done" role="status">
              {t.published(done)}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
