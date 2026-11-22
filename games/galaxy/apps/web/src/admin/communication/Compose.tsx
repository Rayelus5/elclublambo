import { type AdminMailType, allGifts, bigGiftReasons, galaxyCount, type Gift, giftIssues, type MailContents, MAX_GALAXIES, parseConfig } from '@galaxy/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState } from 'react';
import { ADMIN_KEY } from '../../api/admin';
import { api } from '../../api/client';
import { useConfigKeys } from '../../api/config';
import { errorText, useMe } from '../../auth/useMe';
import { copy } from '../../copy/es';
import { GiftPicker } from '../../gifts/GiftPicker';
import { BigGiftNote, GiftTray, MAX_ITEMS, MAX_PACKS } from '../../gifts/GiftTray';
import { useGiftCatalog } from '../../gifts/useGiftCatalog';
import { LetterView } from '../../mail/LetterView';
import { DateField } from '../../ui/DateField';
import { Segmented } from '../../ui/Segmented';
import { Select } from '../../ui/Select';
import { type AudienceValue, EMPTY_AUDIENCE } from './audience';
import { AudienceFields, useAudienceReach } from './AudienceFields';
import { SaveTemplate } from './SaveTemplate';
import { TypePicker } from './TypePicker';

// Writing a message (GDD §16.5; mail v2, P3): its kind, title and text, who it goes to (with how many it reaches
// before sending), what it gives — chosen visually in the picker, gathered in the tray — how long it lasts, the reason
// and, when it gives anything, the password. Beside it, the letter as the player will see it and, at once, whether
// the gift is big enough to need a superadmin (the server checks it again).

const t = copy.admin.communication;
const FRESH = { expiresInDays: '30' };
const when = (d: Date) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(d);

/** What a duplicated message or a template starts the form with (mail v2, P5). */
export interface ComposeSeed {
  type: AdminMailType;
  title: string;
  body: string;
  items: Gift[];
  packs: string[];
  expiresInDays: number;
  /** Straight to these accounts (a tournament's cash winner, from «Escribir»). */
  usernames?: string[];
}

export function Compose({ seed }: { seed?: ComposeSeed }) {
  const ids = useId();
  const qc = useQueryClient();
  const me = useMe().data;
  const superadmin = !!me?.roles.includes('superadmin');
  const { catalog } = useGiftCatalog();
  const [f, setF] = useState<Record<string, string>>(() =>
    seed ? { title: seed.title, body: seed.body, expiresInDays: String(seed.expiresInDays) } : FRESH,
  );
  const [type, setType] = useState<AdminMailType>(seed?.type ?? 'announcement');
  const [aud, setAud] = useState<AudienceValue>(() => (seed?.usernames?.length ? { ...EMPTY_AUDIENCE, kind: 'names', usernames: seed.usernames.join(', ') } : EMPTY_AUDIENCE));
  const [items, setItems] = useState<Gift[]>(seed?.items ?? []);
  const [packs, setPacks] = useState<string[]>(seed?.packs ?? []);
  const [done, setDone] = useState<string | null>(null);
  const [later, setLater] = useState(false);
  const [template, setTemplate] = useState('');
  const [saving, setSaving] = useState(false);
  const mailRow = useConfigKeys().data?.find((k) => k.key === 'mail');
  const templates = useMemo(() => (mailRow ? parseConfig('mail', mailRow.data).templates : []), [mailRow]);
  const applyTemplate = (id: string) => {
    setTemplate(id);
    const tpl = templates.find((x) => x.id === id);
    if (!tpl) return;
    setType(tpl.type);
    setF((x) => ({ ...x, title: tpl.title, body: tpl.body, expiresInDays: String(tpl.expiresInDays) }));
    setItems(tpl.items);
    setPacks(tpl.packs.filter((p) => catalog?.packs.some((k) => k.id === p && k.enabled)));
  };
  // The clock, a tick every half minute: a time chosen for later stops being valid when it passes.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);
  const scheduledAt = later && f['scheduledAt'] ? new Date(f['scheduledAt']) : null;
  const lateOk = !later || (!!scheduledAt && !Number.isNaN(scheduledAt.getTime()) && scheduledAt.getTime() > nowMs);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const reach = useAudienceReach(aud);
  const { audience, recipients } = reach;

  const contents: MailContents = useMemo(
    () => ({
      v: 2,
      items,
      packs: packs.flatMap((id) => {
        const p = catalog?.packs.find((x) => x.id === id);
        return p ? [{ id: p.id, name: p.name, art: p.art, items: p.items }] : [];
      }),
    }),
    [items, packs, catalog],
  );
  // Once per change of the gift, not per keystroke (whether a galaxy can be made takes a moment).
  const gifts = useMemo(() => allGifts(contents), [contents]);
  const giving = gifts.length > 0;
  const issues = useMemo(() => (catalog ? giftIssues(gifts, catalog.live) : []), [gifts, catalog]);
  const big = useMemo(() => (catalog && gifts.length > 0 ? bigGiftReasons(gifts, recipients ?? 0, catalog.limits, catalog.cosmetics) : []), [gifts, recipients, catalog]);
  const tooMany = galaxyCount(gifts) > MAX_GALAXIES;
  const blocked = (big.length > 0 && !superadmin) || tooMany;

  const send = useMutation({
    mutationFn: (body: unknown) => api<{ id: string; recipients: number }>('/admin/mail', { method: 'POST', body }),
    onSuccess: (r) => {
      setDone(scheduledAt ? t.scheduledDone : t.sent(r.recipients));
      setF(FRESH);
      // Who it went to is cleared, but not how it was chosen.
      setAud((a) => ({ ...EMPTY_AUDIENCE, kind: a.kind }));
      setItems([]);
      setPacks([]);
      setLater(false);
      setTemplate('');
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ADMIN_KEY }),
  });
  const ready =
    !!audience &&
    recipients !== undefined &&
    (f['title'] ?? '').trim().length > 0 &&
    (f['body'] ?? '').trim().length > 0 &&
    (f['reason'] ?? '').trim().length >= 3 &&
    (!giving || (f['password'] ?? '').length > 0) &&
    issues.length === 0 &&
    !blocked &&
    lateOk &&
    !send.isPending;

  const field = (k: string, label: string, opts: { type?: string; hint?: string; numeric?: boolean } = {}) => (
    <div className="field">
      <label htmlFor={`${ids}-${k}`}>{label}</label>
      <div className="control">
        <input
          id={`${ids}-${k}`}
          type={opts.type ?? 'text'}
          inputMode={opts.numeric ? 'numeric' : undefined}
          autoComplete={opts.type === 'password' ? 'current-password' : 'off'}
          maxLength={k === 'title' ? 80 : undefined}
          value={f[k] ?? ''}
          onChange={(e) => set(k, opts.numeric ? e.target.value.replace(/\D/g, '') : e.target.value)}
        />
      </div>
      {opts.hint ? <p className="hint">{opts.hint}</p> : null}
    </div>
  );

  const now = new Date(nowMs);
  const expires = new Date(now.getTime() + Math.max(1, Number(f['expiresInDays'] || 30)) * 86_400_000);
  return (
    <>
    <form
      className="lip panel comms-compose"
      aria-label={t.composeTitle}
      onSubmit={(e) => {
        e.preventDefault();
        // Only this form's own submit sends: a dialog's (the template's) is not the message (P6 review).
        if (e.target !== e.currentTarget) return;
        if (!ready || !audience) return;
        setDone(null);
        send.mutate({
          title: f['title']!.trim(),
          body: f['body']!.trim(),
          type,
          gifts: { items, packs },
          audience,
          expiresInDays: Number(f['expiresInDays'] || 30),
          ...(scheduledAt ? { scheduledAt: scheduledAt.toISOString() } : {}),
          reason: f['reason']!.trim(),
          ...(giving ? { password: f['password'] } : {}),
        });
      }}
    >
      <h2>{t.composeTitle}</h2>
      <div className="comms-compose-grid">
        <div className="comms-compose-main">
          {templates.length > 0 ? (
            <div className="field comms-template-pick">
              <label htmlFor={`${ids}-tpl`}>{t.templates.pick}</label>
              <div className="control">
                <Select id={`${ids}-tpl`} size="lg" block value={template} options={[{ value: '', label: t.templates.none }, ...templates.map((x) => ({ value: x.id, label: x.name }))]} onChange={applyTemplate} />
              </div>
            </div>
          ) : null}
          <TypePicker value={type} onChange={setType} />
          {field('title', t.fields.title)}
          <div className="field">
            <label htmlFor={`${ids}-body`}>{t.fields.body}</label>
            <div className="control">
              <textarea id={`${ids}-body`} rows={5} maxLength={2000} value={f['body'] ?? ''} onChange={(e) => set('body', e.target.value)} />
            </div>
          </div>
          <AudienceFields value={aud} onChange={setAud} reach={reach} />
          <fieldset className="comms-gifts">
            <legend>{t.giftsTitle}</legend>
            <p className="hint">{t.giftsHint}</p>
            {catalog ? (
              <>
                <GiftTray
                  items={items}
                  packs={contents.packs}
                  catalog={catalog}
                  issues={issues}
                  onRemove={(i) => setItems((x) => x.filter((_, k) => k !== i))}
                  onRemovePack={(id) => setPacks((x) => x.filter((p) => p !== id))}
                />
                <GiftPicker
                  catalog={catalog}
                  packsChosen={packs}
                  itemsFull={items.length >= MAX_ITEMS}
                  packsFull={packs.length >= MAX_PACKS}
                  onAdd={(gift) => setItems((x) => (x.length >= MAX_ITEMS ? x : [...x, gift]))}
                  onAddPack={(id) => setPacks((x) => (x.includes(id) || x.length >= MAX_PACKS ? x : [...x, id]))}
                />
              </>
            ) : (
              <p className="panel-note">{t.loadingGifts}</p>
            )}
          </fieldset>
          <div className="field">
            <span className="field-label" id={`${ids}-when`}>
              {t.fields.when}
            </span>
            <Segmented<'now' | 'later'>
              aria-labelledby={`${ids}-when`}
              value={later ? 'later' : 'now'}
              options={[
                { value: 'now', label: t.whenNow },
                { value: 'later', label: t.whenLater },
              ]}
              onChange={(v) => setLater(v === 'later')}
            />
          </div>
          {later ? (
            <div className="field">
              <label htmlFor={`${ids}-scheduledAt`}>{t.fields.scheduledAt}</label>
              <div className="control">
                <DateField id={`${ids}-scheduledAt`} time value={f['scheduledAt'] ?? ''} onChange={(v) => set('scheduledAt', v)} />
              </div>
              <p className={f['scheduledAt'] && !lateOk ? 'field-error' : 'hint'}>{f['scheduledAt'] && !lateOk ? t.scheduleLate : t.scheduleHint}</p>
            </div>
          ) : null}
          <div className="comms-row">
            {field('expiresInDays', t.fields.expires, { numeric: true, hint: t.expiresHint })}
            {field('reason', copy.admin.fields.reason)}
          </div>
        </div>
        <aside className="comms-compose-aside">
          <section className="comms-preview" aria-label={t.preview}>
            <h3 className="comms-preview-title">{t.preview}</h3>
            {catalog ? (
              <LetterView
                type={type}
                title={(f['title'] ?? '').trim() || t.previewTitle}
                body={(f['body'] ?? '').trim() || t.previewBody}
                at={now.toISOString()}
                expiresAt={expires.toISOString()}
                contents={contents}
                catalog={catalog}
              />
            ) : null}
          </section>
          {catalog ? <BigGiftNote reasons={big} superadmin={superadmin} catalog={catalog} /> : null}
          {tooMany ? (
            <p className="field-error" role="alert">
              {String(copy.errors.galaxy_too_many)}
            </p>
          ) : null}
          {giving ? field('password', copy.admin.fields.password, { type: 'password', hint: copy.admin.passwordHint }) : null}
          {send.error ? (
            <p className="field-error" role="alert">
              {errorText(send.error, copy.errors)}
            </p>
          ) : null}
          {done !== null ? (
            <p className="admin-done" role="status">
              {done}
            </p>
          ) : null}
          <button type="submit" className={`lip pill ${giving ? 'danger' : 'pill-solar'}`} disabled={!ready} aria-busy={send.isPending || undefined}>
            {scheduledAt ? t.schedule : t.send(recipients ?? 0)}
          </button>
          {later && scheduledAt && lateOk ? <p className="hint comms-when">{t.scheduledFor(when(scheduledAt))}</p> : null}
          {mailRow ? (
            <button type="button" className="lip pill small comms-save-template" disabled={!(f['title'] ?? '').trim() || !(f['body'] ?? '').trim()} onClick={() => setSaving(true)}>
              {t.templates.save}
            </button>
          ) : null}
        </aside>
      </div>
    </form>
    {saving && mailRow ? (
      <SaveTemplate
        row={mailRow}
        draft={{ type, title: (f['title'] ?? '').trim(), body: (f['body'] ?? '').trim(), items, packs, expiresInDays: Math.max(1, Math.min(365, Number(f['expiresInDays'] || 30))) }}
        onClose={() => setSaving(false)}
        onSaved={() => {
          setSaving(false);
          setDone(t.templates.saved);
        }}
      />
    ) : null}
    </>
  );
}
