import { type AdminReferralOwner, MAIL_GIFTS, type MailGift, type MailGifts, mailGiftsSchema, type ReferralRules, usernameSchema } from '@galaxy/shared';
import { useId, useState } from 'react';
import { usePublishConfig } from '../../api/config';
import { useReferralOwner, useSaveReferralOwner } from '../../api/referrals';
import { errorText } from '../../auth/useMe';
import { copy, fmt } from '../../copy/es';
import { giftsText } from '../../referrals/invite';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { Switch } from '../../ui/Switch';
import { ConfigEditor } from '../ConfigScreen';
import { PublishFields } from '../PublishFields';
import { useReferralsConfig } from './parts';

// «Premios» (plan «referidos», part R2): the global rules as the live config has them (with the sign-up's «código
// obligatorio» switch, and the key's own editor embedded, which asks for the admin's password like any publish), and
// an owner's own rewards: their gifts or level instead of the global ones, field by field, with a reason.

const t = copy.admin.referrals;
const giftLabel = copy.admin.communication.gifts;
type ReferralsCfg = NonNullable<ReturnType<typeof useReferralsConfig>['cfg']>;

/** «Premios»: the global rules (or their editor) beside an owner's own rewards. */
export function RewardsTab({ params, change }: { params: URLSearchParams; change: (next: Record<string, string | null>) => void }) {
  const { row, cfg, error } = useReferralsConfig();
  const [editing, setEditing] = useState(false);
  return (
    <div className={`ref-rewards${editing ? ' editing' : ''}`}>
      {error ? (
        <p className="field-error" role="alert">
          {errorText(error, copy.errors)}
        </p>
      ) : null}
      {row && cfg ? <GlobalRules row={row} cfg={cfg} editing={editing} onEditing={setEditing} /> : null}
      <OwnerRules params={params} change={change} cfg={cfg} />
    </div>
  );
}

function GlobalRules({ row, cfg, editing, onEditing }: { row: NonNullable<ReturnType<typeof useReferralsConfig>['row']>; cfg: ReferralsCfg; editing: boolean; onEditing: (on: boolean) => void }) {
  const id = useId();
  const [asking, setAsking] = useState(false);
  const publish = usePublishConfig('referrals');
  const action = cfg.required ? t.requiredOff : t.requiredOn;
  const close = () => {
    publish.reset();
    setAsking(false);
  };
  return (
    <section className="lip panel stats-section ref-global" aria-labelledby={id}>
      <header className="stats-head ref-head">
        <h2 id={id}>{t.globalTitle}</h2>
        <button type="button" className="lip pill small" aria-expanded={editing} onClick={() => onEditing(!editing)}>
          <Icon name={editing ? 'close' : 'wrench'} />
          <span>{editing ? t.closeGlobal : t.editGlobal}</span>
        </button>
      </header>
      {editing ? (
        <ConfigEditor row={row} />
      ) : (
        <>
          <p className="stats-sub">{t.globalIntro}</p>
          <div className="admin-toggle ref-required">
            <span id={`${id}-req`} className="admin-toggle-label">
              {t.required}
            </span>
            <Switch checked={cfg.required} aria-labelledby={`${id}-req`} aria-describedby={`${id}-req-state`} onChange={() => setAsking(true)} />
            <p id={`${id}-req-state`} className="ref-required-state">
              {cfg.required ? t.on : t.off}
            </p>
          </div>
          <dl className="ref-rules">
            <div>
              <dt>{t.newcomerGets}</dt>
              <dd>{giftsText(cfg.newcomerGifts, t.nothing)}</dd>
            </div>
            <div>
              <dt>{t.ownerGets}</dt>
              <dd>{giftsText(cfg.ownerGifts, t.nothing)}</dd>
            </div>
            <div>
              <dt>{t.activationLevel}</dt>
              <dd>{fmt(cfg.activationLevel)}</dd>
            </div>
          </dl>
          <div className="ref-holds">
            <h3>{t.holdsTitle}</h3>
            <ul>
              {t.holds(cfg.perCodePerDay, cfg.ownerPerWeek, cfg.ipSignupsPerDay, cfg.sharedIpDays).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </>
      )}
      {asking ? (
        <Dialog title={action} onClose={close} className="admin-dialog">
          <PublishFields busy={publish.isPending} disabled={false} error={publish.error} label={action} onPublish={(reason, password) => publish.mutate({ data: { required: !cfg.required }, reason, password }, { onSuccess: close })} />
        </Dialog>
      ) : null}
    </section>
  );
}

function OwnerRules({ params, change, cfg }: { params: URLSearchParams; change: (next: Record<string, string | null>) => void; cfg: ReferralsCfg | null }) {
  const id = useId();
  const owner = (params.get('dueno') ?? '').trim().toLowerCase();
  const valid = usernameSchema.safeParse(owner).success;
  const [text, setText] = useState(owner);
  const [saved, setSaved] = useState(false);
  const found = useReferralOwner(valid ? owner : '');
  const save = useSaveReferralOwner(owner);
  const ok = usernameSchema.safeParse(text.trim()).success;
  const data = valid ? found.data : undefined;
  return (
    <section className="lip panel stats-section ref-owner" aria-labelledby={id}>
      <header className="stats-head">
        <h2 id={id}>{t.ownerTitle}</h2>
      </header>
      <p className="stats-sub">{t.ownerIntro}</p>
      <form
        className="ref-find"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          setSaved(false);
          save.reset();
          change({ dueno: text.trim().toLowerCase() });
        }}
      >
        <div className="field">
          <label htmlFor={`${id}-who`}>{t.ownerSearch}</label>
          <div className="control">
            <input id={`${id}-who`} type="search" autoComplete="off" maxLength={20} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        </div>
        <button type="submit" className="lip pill" disabled={!ok}>
          <Icon name="radar" />
          <span>{t.find}</span>
        </button>
      </form>
      {valid && found.error ? (
        <p className="field-error" role="alert">
          {errorText(found.error, copy.errors)}
        </p>
      ) : null}
      {data && cfg ? (
        <>
          <Effective data={data} />
          <p className="cf-warning ref-replace" role="note">
            <Icon name="alert" />
            <span>{t.replaceNote}</span>
          </p>
          <OwnerForm key={`${data.owner}:${JSON.stringify(data.override)}`} data={data} cfg={cfg} save={save} onSaved={() => setSaved(true)} onEdit={() => setSaved(false)} />
        </>
      ) : null}
      {saved ? (
        <p className="admin-done" role="status">
          {t.savedOwner}
        </p>
      ) : null}
    </section>
  );
}

/** What the owner's codes follow now, each rule marked as their own or the global one. */
function Effective({ data }: { data: AdminReferralOwner }) {
  const id = useId();
  const o = data.override;
  const rows: [string, string, boolean][] = [
    [t.ownerGift, giftsText(data.rules.ownerGifts, t.nothing), !!o?.ownerGifts],
    [t.newcomerGift, giftsText(data.rules.newcomerGifts, t.nothing), !!o?.newcomerGifts],
    [t.level, fmt(data.rules.activationLevel), o?.activationLevel != null],
  ];
  return (
    <section className="ref-effective" aria-labelledby={id}>
      <h3 id={id}>{t.effective(data.owner)}</h3>
      <dl className="ref-rules">
        {rows.map(([label, value, own]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <span>{value}</span>
              <span className={`admin-chip ref-chip ${own ? 'staff' : ''}`}>{own ? t.own : t.global}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

type GiftKey = 'ownerGifts' | 'newcomerGifts';
type GiftDraft = Record<MailGift, string>;
const toDraft = (g: MailGifts): GiftDraft => ({ coins: g.coins ? String(g.coins) : '', dust: g.dust ? String(g.dust) : '', signal: g.signal ? String(g.signal) : '' });
/** Gifts in a fixed order, without the zeros (so the same gifts always compare equal). */
const tidyGifts = (g: MailGifts | null | undefined): MailGifts | null => (g ? Object.fromEntries(MAIL_GIFTS.filter((k) => (g[k] ?? 0) > 0).map((k) => [k, g[k]])) : null);

/** A draft as gifts: null is «the global ones»; `ok` false while a number is out of range. */
function giftsOf(d: GiftDraft | null): { ok: boolean; value: MailGifts | null } {
  if (d === null) return { ok: true, value: null };
  const out: MailGifts = {};
  for (const k of MAIL_GIFTS) if (d[k].trim() !== '') out[k] = Number(d[k]);
  const parsed = mailGiftsSchema.safeParse(out);
  return parsed.success ? { ok: true, value: tidyGifts(parsed.data) } : { ok: false, value: null };
}

function OwnerForm({
  data,
  cfg,
  save,
  onSaved,
  onEdit,
}: {
  data: AdminReferralOwner;
  cfg: ReferralsCfg;
  save: ReturnType<typeof useSaveReferralOwner>;
  onSaved: () => void;
  onEdit: () => void;
}) {
  const ids = useId();
  const o = data.override;
  const [gifts, setGifts] = useState<Record<GiftKey, GiftDraft | null>>({
    ownerGifts: o?.ownerGifts ? toDraft(o.ownerGifts) : null,
    newcomerGifts: o?.newcomerGifts ? toDraft(o.newcomerGifts) : null,
  });
  const [level, setLevel] = useState<string | null>(o?.activationLevel != null ? String(o.activationLevel) : null);
  const [reason, setReason] = useState('');
  const owner = giftsOf(gifts.ownerGifts);
  const newcomer = giftsOf(gifts.newcomerGifts);
  const levelValue = level === null ? null : Number(level);
  const levelOk = levelValue === null || (level !== '' && Number.isInteger(levelValue) && levelValue >= 1 && levelValue <= 100);
  const next = { ownerGifts: owner.value, newcomerGifts: newcomer.value, activationLevel: levelOk ? levelValue : null };
  const now = { ownerGifts: tidyGifts(o?.ownerGifts), newcomerGifts: tidyGifts(o?.newcomerGifts), activationLevel: o?.activationLevel ?? null };
  const changed = JSON.stringify(next) !== JSON.stringify(now);
  const ready = owner.ok && newcomer.ok && levelOk && changed && reason.trim().length >= 3 && !save.isPending;
  const edit = (f: () => void) => {
    onEdit();
    save.reset();
    f();
  };
  const global: ReferralRules = { ownerGifts: cfg.ownerGifts, newcomerGifts: cfg.newcomerGifts, activationLevel: cfg.activationLevel };

  const giftSet = (which: GiftKey, legend: string, ok: boolean) => {
    const draft = gifts[which];
    return (
      <fieldset className="ref-rule">
        <legend>{legend}</legend>
        <div className="ref-use-global">
          <Switch checked={draft === null} aria-label={t.useGlobalFor[which]} onChange={(on) => edit(() => setGifts((g) => ({ ...g, [which]: on ? null : toDraft(data.rules[which]) })))} />
          <span aria-hidden="true">{t.useGlobal[which]}</span>
        </div>
        {draft ? (
          <div className="comms-row">
            {MAIL_GIFTS.map((k) => (
              <div key={k} className="field">
                <label htmlFor={`${ids}-${which}-${k}`}>{giftLabel[k]}</label>
                <div className="control">
                  <input
                    id={`${ids}-${which}-${k}`}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    aria-invalid={!ok || undefined}
                    value={draft[k]}
                    onChange={(e) => edit(() => setGifts((g) => ({ ...g, [which]: { ...g[which]!, [k]: e.target.value.replace(/\D/g, '') } })))}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="panel-note ref-global-is">{t.globalIs(giftsText(global[which], t.nothing))}</p>
        )}
        {!ok ? (
          <p className="field-error" role="alert">
            {t.giftsInvalid}
          </p>
        ) : null}
      </fieldset>
    );
  };

  return (
    <form
      className="ref-owner-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) save.mutate({ ...next, reason: reason.trim() }, { onSuccess: onSaved });
      }}
    >
      {giftSet('ownerGifts', t.ownerGift, owner.ok)}
      {giftSet('newcomerGifts', t.newcomerGift, newcomer.ok)}
      <fieldset className="ref-rule">
        <legend>{t.level}</legend>
        <div className="ref-use-global">
          <Switch checked={level === null} aria-label={t.useGlobalFor.activationLevel} onChange={(on) => edit(() => setLevel(on ? null : String(data.rules.activationLevel)))} />
          <span aria-hidden="true">{t.useGlobal.activationLevel}</span>
        </div>
        {level !== null ? (
          <div className="field ref-level">
            <label htmlFor={`${ids}-level`} className="sr-only">
              {t.level}
            </label>
            <div className="control">
              <input
                id={`${ids}-level`}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                aria-invalid={!levelOk || undefined}
                aria-describedby={`${ids}-level-hint`}
                value={level}
                onChange={(e) => edit(() => setLevel(e.target.value.replace(/\D/g, '')))}
              />
            </div>
            <p id={`${ids}-level-hint`} className="hint">
              {t.levelHint}
            </p>
          </div>
        ) : (
          <p className="panel-note ref-global-is">{t.globalLevel(global.activationLevel)}</p>
        )}
        {!levelOk ? (
          <p className="field-error" role="alert">
            {t.levelInvalid}
          </p>
        ) : null}
      </fieldset>
      <div className="field">
        <label htmlFor={`${ids}-reason`}>{copy.admin.fields.reason}</label>
        <div className="control">
          <input id={`${ids}-reason`} type="text" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
      {save.error ? (
        <p className="field-error" role="alert">
          {errorText(save.error, copy.errors)}
        </p>
      ) : null}
      <button type="submit" className="lip pill pill-solar" disabled={!ready} aria-busy={save.isPending || undefined}>
        {t.saveOwner}
      </button>
    </form>
  );
}
