import { type AdminMailType, allGifts, bigGiftReasons, galaxyCount, type Gift, giftIssues, type MailAudience, type MailContents, MAX_GALAXIES } from '@galaxy/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { ADMIN_KEY } from '../../api/admin';
import { api } from '../../api/client';
import { useMailPreview } from '../../api/mail';
import { errorText, useMe } from '../../auth/useMe';
import { copy } from '../../copy/es';
import { GiftPicker } from '../../gifts/GiftPicker';
import { BigGiftNote, GiftTray, MAX_ITEMS, MAX_PACKS } from '../../gifts/GiftTray';
import { useGiftCatalog } from '../../gifts/useGiftCatalog';
import { LetterView } from '../../mail/LetterView';
import { DateField } from '../../ui/DateField';
import { Select } from '../../ui/Select';
import { useSettled } from '../../ui/useSettled';
import { type AudienceKind, audienceOf } from './audience';
import { TypePicker } from './TypePicker';

// Writing a message (GDD §16.5; mail v2, P3): its kind, title and text, who it goes to (with how many it reaches
// before sending), what it gives — chosen visually in the picker, gathered in the tray — how long it lasts, the reason
// and, when it gives anything, the password. Beside it, the letter as the player will see it and, at once, whether
// the gift is big enough to need a superadmin (the server checks it again).

const t = copy.admin.communication;
const FRESH = { expiresInDays: '30' };

export function Compose() {
  const ids = useId();
  const qc = useQueryClient();
  const me = useMe().data;
  const superadmin = !!me?.roles.includes('superadmin');
  const { catalog } = useGiftCatalog();
  const [f, setF] = useState<Record<string, string>>(FRESH);
  const [type, setType] = useState<AdminMailType>('announcement');
  const [kind, setKind] = useState<AudienceKind>('all');
  const [items, setItems] = useState<Gift[]>([]);
  const [packs, setPacks] = useState<string[]>([]);
  const [done, setDone] = useState<number | null>(null);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const { audience, problem } = audienceOf(kind, f);
  const settled = useSettled(audience ? JSON.stringify(audience) : '', 400);
  const preview = useMailPreview(settled ? (JSON.parse(settled) as MailAudience) : null);
  const recipients = settled && settled === JSON.stringify(audience) ? preview.data?.recipients : undefined;

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
      setDone(r.recipients);
      setF(FRESH);
      setItems([]);
      setPacks([]);
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
    !send.isPending;

  const field = (k: string, label: string, opts: { type?: string; hint?: string; numeric?: boolean } = {}) => (
    <div className="field">
      <label htmlFor={`${ids}-${k}`}>{label}</label>
      <div className="control">
        {opts.type === 'date' ? (
          <DateField id={`${ids}-${k}`} value={f[k] ?? ''} onChange={(v) => set(k, v)} />
        ) : (
          <input
            id={`${ids}-${k}`}
            type={opts.type ?? 'text'}
            inputMode={opts.numeric ? 'numeric' : undefined}
            autoComplete={opts.type === 'password' ? 'current-password' : 'off'}
            maxLength={k === 'title' ? 80 : undefined}
            value={f[k] ?? ''}
            onChange={(e) => set(k, opts.numeric ? e.target.value.replace(/\D/g, '') : e.target.value)}
          />
        )}
      </div>
      {opts.hint ? <p className="hint">{opts.hint}</p> : null}
    </div>
  );

  const now = new Date();
  const expires = new Date(now.getTime() + Math.max(1, Number(f['expiresInDays'] || 30)) * 86_400_000);
  return (
    <form
      className="lip panel comms-compose"
      aria-label={t.composeTitle}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || !audience) return;
        setDone(null);
        send.mutate({
          title: f['title']!.trim(),
          body: f['body']!.trim(),
          type,
          gifts: { items, packs },
          audience,
          expiresInDays: Number(f['expiresInDays'] || 30),
          reason: f['reason']!.trim(),
          ...(giving ? { password: f['password'] } : {}),
        });
      }}
    >
      <h2>{t.composeTitle}</h2>
      <div className="comms-compose-grid">
        <div className="comms-compose-main">
          <TypePicker value={type} onChange={setType} />
          {field('title', t.fields.title)}
          <div className="field">
            <label htmlFor={`${ids}-body`}>{t.fields.body}</label>
            <div className="control">
              <textarea id={`${ids}-body`} rows={5} maxLength={2000} value={f['body'] ?? ''} onChange={(e) => set('body', e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor={`${ids}-audience`}>{t.fields.audience}</label>
            <div className="control">
              <Select<AudienceKind>
                id={`${ids}-audience`}
                size="lg"
                block
                value={kind}
                options={(['all', 'names', 'segment'] as const).map((k) => ({ value: k, label: t.audiences[k] ?? k }))}
                onChange={setKind}
              />
            </div>
          </div>
          {kind === 'names' ? (
            <div className="field">
              <label htmlFor={`${ids}-usernames`}>{t.fields.usernames}</label>
              <div className="control">
                <textarea id={`${ids}-usernames`} rows={3} value={f['usernames'] ?? ''} onChange={(e) => set('usernames', e.target.value)} />
              </div>
              <p className="hint">{t.usernamesHint}</p>
            </div>
          ) : null}
          {kind === 'segment' ? (
            <div className="comms-row">
              {field('minLevel', t.fields.minLevel, { numeric: true })}
              {field('maxLevel', t.fields.maxLevel, { numeric: true })}
              {field('joinedFrom', t.fields.joinedFrom, { type: 'date' })}
              {field('joinedTo', t.fields.joinedTo, { type: 'date' })}
              <p className="hint comms-wide">{t.segmentHint}</p>
            </div>
          ) : null}
          <p className={`comms-reach${problem ? ' bad' : ''}`} aria-live="polite">
            {problem ?? (audience ? (recipients === undefined ? t.counting : t.reach(recipients)) : null)}
          </p>
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
              {t.sent(done)}
            </p>
          ) : null}
          <button type="submit" className={`lip pill ${giving ? 'danger' : 'pill-solar'}`} disabled={!ready} aria-busy={send.isPending || undefined}>
            {t.send(recipients ?? 0)}
          </button>
        </aside>
      </div>
    </form>
  );
}
