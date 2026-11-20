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
// be removed; and how many days before expiring a message warns. Every change is published at once (2026-11-17, the
// owner: a draft published apart got lost on reload): saving a pack, removing a pack or a template, or the days, each
// asks for a reason and the password and publishes the whole key over what is live, with its version. If another admin
// published in between (config_conflict), the page says so and loads what is published; the change typed is kept, to
// publish again on top of it. Its history and rollback are on the key's general page («Historial y edición avanzada»).

const t = copy.admin.packs;
const g = copy.gifts;
const EMPTY: MailPack = { id: '', name: '', art: 'parcel', enabled: true, items: [] };

/** A pack saved over what is live: in place of the one it was (by id), or added. */
function withPack(d: MailConfig, was: string | null, pack: MailPack): MailConfig {
  const at = was === null ? -1 : d.packs.findIndex((p) => p.id === was);
  return { ...d, packs: at < 0 ? [...d.packs, pack] : d.packs.map((p, i) => (i === at ? pack : p)) };
}

export function PackLibraryScreen() {
  const ids = useId();
  const keys = useConfigKeys();
  const row = keys.data?.find((k) => k.key === 'mail');
  const live = useMemo(() => (row ? parseConfig('mail', row.data) : null), [row]);
  const { catalog } = useGiftCatalog();
  const publish = usePublishConfig('mail');
  // The pack open in the editor (`was`: its id before, null for a new one), and what is being removed.
  const [editing, setEditing] = useState<{ was: string | null; pack: MailPack } | null>(null);
  const [removing, setRemoving] = useState<{ kind: 'pack' | 'template'; id: string; name: string } | null>(null);
  const [done, setDone] = useState<number | null>(null);
  // The warning days as typed (a valid number, 1 to 30, different from the live one, can be published).
  const [daysText, setDaysText] = useState<string | null>(null);
  const packs = live?.packs ?? [];
  const conflict = publish.error instanceof ApiError && publish.error.code === 'config_conflict';
  const days = daysText === null ? null : Number(daysText);
  const daysReady = days !== null && days >= 1 && days <= 30 && days !== live?.warnDays;

  /** Publishes `fn` over what is live now, with its version; `after` runs once it is in. */
  const save = (fn: (d: MailConfig) => MailConfig, reason: string, password: string, after: () => void) => {
    if (!live || !row) return;
    setDone(null);
    publish.mutate(
      { data: fn(live), baseVersion: row.version, reason, password },
      {
        onSuccess: (r) => {
          setDone(r.version);
          after();
        },
      },
    );
  };
  const open = (next: typeof editing) => {
    publish.reset();
    setRemoving(null);
    setEditing(next);
  };
  const ask = (next: typeof removing) => {
    publish.reset();
    setEditing(null);
    setRemoving(next);
  };
  // The publish error belongs to the form in use (a conflict is said once, at the top).
  const errorOf = conflict ? null : publish.error;

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
      {conflict ? (
        <div className="lip panel pack-lib-moved" role="alert">
          <p>{t.moved}</p>
          <button
            type="button"
            className="lip pill small"
            onClick={() => {
              publish.reset();
              void keys.refetch();
            }}
          >
            {t.reload}
          </button>
        </div>
      ) : null}
      {done !== null ? (
        <p className="admin-done" role="status">
          {t.published(done)}
        </p>
      ) : null}
      {editing && catalog ? (
        <PackEditor
          key={editing.was ?? 'new'}
          pack={editing.pack}
          isNew={editing.was === null}
          taken={packs.filter((p) => p.id !== editing.was).map((p) => p.id)}
          catalog={catalog}
          busy={publish.isPending}
          error={errorOf}
          onSave={(pack, reason, password) => save((d) => withPack(d, editing.was, pack), reason, password, () => setEditing(null))}
          onCancel={() => open(null)}
        />
      ) : null}
      {removing ? (
        <section className="lip panel pack-lib-remove" aria-label={t.removeTitle(removing.name)}>
          <h2>{t.removeTitle(removing.name)}</h2>
          <p className="panel-note">{removing.kind === 'pack' ? t.removePackHint : t.removeTemplateHint}</p>
          <PublishFields
            busy={publish.isPending}
            disabled={false}
            error={errorOf}
            label={t.removePublish}
            onPublish={(reason, password) =>
              save(
                (d) => (removing.kind === 'pack' ? { ...d, packs: d.packs.filter((p) => p.id !== removing.id) } : { ...d, templates: d.templates.filter((x) => x.id !== removing.id) }),
                reason,
                password,
                () => setRemoving(null),
              )
            }
          />
          <button type="button" className="lip pill small" onClick={() => ask(null)}>
            {t.cancel}
          </button>
        </section>
      ) : null}
      {!editing && live && catalog ? (
        <>
          {packs.length === 0 ? <p className="panel-note">{t.empty}</p> : null}
          <ul className="pack-lib-grid">
            {packs.map((p) => (
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
                  <button type="button" className="lip pill small" aria-label={t.editOf(p.name)} onClick={() => open({ was: p.id, pack: p })}>
                    {t.edit}
                  </button>
                  <button type="button" className="lip iconbtn small" aria-label={t.removeOf(p.name)} title={t.removeOf(p.name)} onClick={() => ask({ kind: 'pack', id: p.id, name: p.name })}>
                    <Icon name="trash" />
                  </button>
                </div>
              </li>
            ))}
            <li>
              <button type="button" className="pack-lib-new" onClick={() => open({ was: null, pack: EMPTY })}>
                <Icon name="plus" />
                <span>{t.create}</span>
              </button>
            </li>
          </ul>

          <section className="lip panel pack-lib-more" aria-labelledby={`${ids}-tpl`}>
            <h2 id={`${ids}-tpl`}>{t.templatesTitle}</h2>
            {live.templates.length === 0 ? <p className="panel-note">{t.templatesEmpty}</p> : null}
            <ul className="pack-lib-templates">
              {live.templates.map((tpl) => (
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
                    onClick={() => ask({ kind: 'template', id: tpl.id, name: tpl.name })}
                  >
                    <Icon name="trash" />
                  </button>
                </li>
              ))}
            </ul>
            <section className="pack-lib-days" aria-label={t.daysBox}>
              <div className="field">
                <label htmlFor={`${ids}-days`}>{t.warnDays}</label>
                <div className="control">
                  <input
                    id={`${ids}-days`}
                    inputMode="numeric"
                    autoComplete="off"
                    value={daysText ?? String(live.warnDays)}
                    onChange={(e) => {
                      publish.reset();
                      setDaysText(e.target.value.replace(/\D/g, '').slice(0, 2));
                    }}
                  />
                </div>
                <p className="hint">{t.warnDaysHint}</p>
              </div>
              {daysReady && !editing && !removing ? (
                <PublishFields busy={publish.isPending} disabled={false} error={errorOf} label={t.daysSave} onPublish={(reason, password) => save((d) => ({ ...d, warnDays: days! }), reason, password, () => setDaysText(null))} />
              ) : null}
            </section>
          </section>
        </>
      ) : null}
    </section>
  );
}
