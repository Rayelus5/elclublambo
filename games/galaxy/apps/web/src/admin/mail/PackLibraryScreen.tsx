import { type MailConfig, type MailPack, parseConfig } from '@galaxy/shared';
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../../api/client';
import { useConfigKeys, usePublishConfig } from '../../api/config';
import { copy } from '../../copy/es';
import { GiftArt } from '../../gifts/GiftArt';
import { PackArt } from '../../gifts/PackArt';
import { useGiftCatalog } from '../../gifts/useGiftCatalog';
import { giftWords } from '../../gifts/words';
import { MAIL_TYPE_LOOK, mailTypeName } from '../../mail/types';
import { Icon } from '../../ui/Icon';
import { PublishFields } from '../PublishFields';
import { PackEditor } from './PackEditor';

// The mail's library (mail v2, P4; the owner: «biblioteca de packs»), the `mail` key's own page in Configuración:
// every pack drawn with what it gives, made and changed visually; the templates (saved from Comunicación), which can
// be removed; and how many days before expiring a message warns. Changes stay unpublished until the whole key is
// published with the version they started from (another admin's publish in between answers config_conflict, and this
// page says so and offers to load what is published), a reason and the password. Its history and rollback are on the
// key's general page («Historial y edición avanzada»).

const t = copy.admin.packs;
const g = copy.gifts;
const EMPTY: MailPack = { id: '', name: '', art: 'parcel', enabled: true, items: [] };

/** How many entries differ from what is live: added, removed or changed. */
function changes<T extends { id: string }>(draft: readonly T[], live: readonly T[]): number {
  const ids = new Set([...draft.map((p) => p.id), ...live.map((p) => p.id)]);
  let n = 0;
  for (const id of ids) if (JSON.stringify(draft.find((p) => p.id === id)) !== JSON.stringify(live.find((p) => p.id === id))) n++;
  return n;
}

export function PackLibraryScreen() {
  const ids = useId();
  const keys = useConfigKeys();
  const row = keys.data?.find((k) => k.key === 'mail');
  const live = useMemo(() => (row ? parseConfig('mail', row.data) : null), [row]);
  const { catalog } = useGiftCatalog();
  const publish = usePublishConfig('mail');
  // The draft is the whole key, and the version it started from: a publish carries that version, never a newer one.
  const [draft, setDraft] = useState<{ base: number; data: MailConfig } | null>(null);
  const [editing, setEditing] = useState<{ index: number | null; pack: MailPack } | null>(null);
  const [done, setDone] = useState<number | null>(null);
  // The warning days as typed (only a valid number, 1 to 30, goes to the draft).
  const [daysText, setDaysText] = useState<string | null>(null);
  const data = draft?.data ?? live;
  const packs = data?.packs ?? [];
  const pending = live && data ? changes(data.packs, live.packs) + changes(data.templates, live.templates) + (data.warnDays !== live.warnDays ? 1 : 0) : 0;
  const moved = !!draft && !!row && row.version !== draft.base;
  const conflict = publish.error instanceof ApiError && publish.error.code === 'config_conflict';

  const change = (fn: (d: MailConfig) => MailConfig) => {
    if (!live || !row) return;
    setDraft((d) => ({ base: d?.base ?? row.version, data: fn(d?.data ?? live) }));
    setDone(null);
  };
  const save = (pack: MailPack) => {
    change((d) => {
      const next = [...d.packs];
      if (editing?.index === null || editing?.index === undefined) next.push(pack);
      else next[editing.index] = pack;
      return { ...d, packs: next };
    });
    setEditing(null);
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
      <Link to="/admin/configuracion/mail/avanzado" className="lip pill small pack-lib-advanced">
        <Icon name="list" />
        <span>{t.advanced}</span>
      </Link>
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
      {!editing && live && data && catalog ? (
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
                  <button type="button" className="lip iconbtn small" aria-label={t.removeOf(p.name)} title={t.removeOf(p.name)} onClick={() => change((d) => ({ ...d, packs: d.packs.filter((_, k) => k !== i) }))}>
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

          <section className="lip panel pack-lib-more" aria-labelledby={`${ids}-tpl`}>
            <h2 id={`${ids}-tpl`}>{t.templatesTitle}</h2>
            {data.templates.length === 0 ? <p className="panel-note">{t.templatesEmpty}</p> : null}
            <ul className="pack-lib-templates">
              {data.templates.map((tpl) => (
                <li key={tpl.id}>
                  <span className={`mail-type-chip k-${MAIL_TYPE_LOOK[tpl.type].tone}`}>
                    <Icon name={MAIL_TYPE_LOOK[tpl.type].icon} />
                    <span>{mailTypeName(tpl.type)}</span>
                  </span>
                  <span className="pack-lib-template-text">
                    <b>{tpl.name}</b>
                    <small>{tpl.title}</small>
                  </span>
                  <button
                    type="button"
                    className="lip iconbtn small"
                    aria-label={t.removeTemplateOf(tpl.name)}
                    title={t.removeTemplateOf(tpl.name)}
                    onClick={() => change((d) => ({ ...d, templates: d.templates.filter((x) => x.id !== tpl.id) }))}
                  >
                    <Icon name="trash" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="field pack-lib-days">
              <label htmlFor={`${ids}-days`}>{t.warnDays}</label>
              <div className="control">
                <input
                  id={`${ids}-days`}
                  inputMode="numeric"
                  autoComplete="off"
                  value={daysText ?? String(data.warnDays)}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 2);
                    setDaysText(v);
                    const n = Number(v);
                    if (n >= 1 && n <= 30) change((d) => ({ ...d, warnDays: n }));
                  }}
                  onBlur={() => setDaysText(null)}
                />
              </div>
              <p className="hint">{t.warnDaysHint}</p>
            </div>
          </section>

          {pending > 0 || publish.error || moved ? (
            <div className="lip panel pack-lib-publish">
              {moved || conflict ? (
                <div className="pack-lib-moved" role="alert">
                  <p>{t.moved}</p>
                  <button
                    type="button"
                    className="lip pill small"
                    onClick={() => {
                      setDraft(null);
                      publish.reset();
                    }}
                  >
                    {t.reload}
                  </button>
                </div>
              ) : null}
              <p className="pack-lib-pending">
                <b>{t.pending(pending)}</b>
                <button
                  type="button"
                  className="lip pill small"
                  onClick={() => {
                    setDraft(null);
                    publish.reset();
                  }}
                >
                  {t.discard}
                </button>
              </p>
              <PublishFields
                busy={publish.isPending}
                disabled={pending === 0 || !draft}
                error={conflict ? null : publish.error}
                label={t.publish}
                onPublish={(reason, password) =>
                  draft &&
                  publish.mutate(
                    { data: draft.data, baseVersion: draft.base, reason, password },
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
