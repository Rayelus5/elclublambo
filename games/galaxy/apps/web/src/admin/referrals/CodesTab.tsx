import { type AdminReferralCode, referralCodeSchema, usernameSchema } from '@galaxy/shared';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { useReferralCodes } from '../../api/referrals';
import { errorText } from '../../auth/useMe';
import { copy, fmt } from '../../copy/es';
import { type CodeState, codeState, inviteLink } from '../../referrals/invite';
import { CopyButton } from '../../ui/CopyButton';
import { HScroll } from '../../ui/HScroll';
import { Icon } from '../../ui/Icon';
import { useSettled } from '../../ui/useSettled';
import { ActionDialog, type FieldSpec } from '../ActionDialog';
import { cellText } from '../DataTable';
import { fromLocalInput, toLocalInput } from '../forms/format';
import { STATE_URL } from './parts';

// «Códigos» (plan «referidos», part R2): every code with its owner, uses, rewarded and held newcomers, state, end, note
// and who made it; a new one for a veteran; and per code, its link and code to copy, its limits, and turning it off or
// on. Every change goes through ActionDialog with a reason (the server audits it).

const t = copy.admin.referrals;
const TONE: Record<CodeState, string> = { on: 'ok', off: 'bad', expired: 'warn', full: 'warn' };
const day = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' });

type Open = { kind: 'create' } | { kind: 'toggle'; code: AdminReferralCode } | { kind: 'edit'; code: AdminReferralCode };

const maxOk = (v: string) => v.trim() === '' || (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 100_000);
const expiryOk = (v: string) => v === '' || fromLocalInput(v) !== undefined;
/** The limits as the server takes them: empty is «no limit» (null). */
const limits = (v: Record<string, string>) => ({
  maxUses: v['maxUses']!.trim() ? Number(v['maxUses']) : null,
  expiresAt: v['expiresAt'] ? (fromLocalInput(v['expiresAt']) ?? null) : null,
  note: v['note']!.trim() || null,
});

/** The fields of a code's limits, with the values it has now when there is one. */
function limitFields(c?: AdminReferralCode): FieldSpec[] {
  return [
    { name: 'maxUses', label: t.fields.maxUses, kind: 'number', optional: true, hint: t.maxUsesHint, initial: c?.maxUses ? String(c.maxUses) : '' },
    { name: 'expiresAt', label: t.fields.expiresAt, kind: 'datetime', optional: true, hint: t.expiresHint, initial: c?.expiresAt ? toLocalInput(c.expiresAt) : '' },
    { name: 'note', label: t.fields.note, kind: 'text', optional: true, hint: t.noteHint, initial: c?.note ?? '' },
  ];
}

/** The code just made, ready to pass on. */
function Created({ code }: { code: string }) {
  return (
    <div className="ref-created">
      <p className="admin-done" role="status">
        {t.created(code)}
      </p>
      <p className="ref-created-code">{code}</p>
      <div className="ref-actions">
        <CopyButton text={inviteLink(code)} label={t.copyLink} name={t.copyLinkOf(code)} />
        <CopyButton text={code} label={t.copyCode} name={t.copyCodeOf(code)} />
      </div>
    </div>
  );
}

/** «Códigos»: the search, «Nuevo código», the table of codes and the dialog of each change. */
export function CodesTab({ params, change }: { params: URLSearchParams; change: (next: Record<string, string | null>) => void }) {
  const ids = useId();
  const [text, setText] = useState(params.get('q') ?? '');
  const q = useSettled((params.get('q') ?? '').trim().slice(0, 40), 300);
  const codes = useReferralCodes(q);
  const [open, setOpen] = useState<Open | null>(null);
  const [done, setDone] = useState(false);
  const list = codes.data;
  const show = (o: Open) => {
    setDone(false);
    setOpen(o);
  };

  return (
    <>
      <div className="mod-toolbar ref-toolbar">
        <div className="field admin-search">
          <label htmlFor={`${ids}-q`}>{t.search}</label>
          <div className="control">
            <input
              id={`${ids}-q`}
              type="search"
              value={text}
              maxLength={40}
              autoComplete="off"
              aria-describedby={`${ids}-q-hint`}
              onChange={(e) => {
                setText(e.target.value);
                change({ q: e.target.value.trim() || null });
              }}
            />
          </div>
          <p id={`${ids}-q-hint`} className="hint">
            {t.codesSearchHint}
          </p>
        </div>
        {list ? (
          <p className="panel-note ref-total" aria-live="polite">
            {t.codesTotal(list.length)}
          </p>
        ) : null}
        <button type="button" className="lip pill pill-solar ref-new" aria-haspopup="dialog" onClick={() => show({ kind: 'create' })}>
          <Icon name="plus" />
          <span>{t.create}</span>
        </button>
      </div>
      {done ? (
        <p className="admin-done" role="status">
          {copy.admin.done}
        </p>
      ) : null}
      {codes.error ? (
        <p className="field-error" role="alert">
          {errorText(codes.error, copy.errors)}
        </p>
      ) : null}
      {list && list.length === 0 ? <p className="panel-note">{q ? t.noCodesMatch : t.noCodes}</p> : null}
      {list && list.length > 0 ? (
        <HScroll variant="table" className="admin-table-wrap">
          <table className="admin-table ref-table" aria-label={t.tabs.codes} aria-busy={codes.isFetching || undefined}>
            <thead>
              <tr>
                {(['code', 'copy', 'owner', 'uses', 'rewarded', 'held', 'state', 'expires', 'note', 'created'] as const).map((c) => (
                  <th key={c} scope="col">
                    {t.cols[c]}
                  </th>
                ))}
                <th scope="col">{t.cols.actions}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const state = codeState(c);
                return (
                  <tr key={c.id}>
                    <th scope="row">
                      <code className="ref-code">{c.code}</code>
                    </th>
                    <td>
                      <div className="ref-actions">
                        <CopyButton text={inviteLink(c.code)} label={t.copyLinkShort} name={t.copyLinkOf(c.code)} />
                        <CopyButton text={c.code} label={t.copyCodeShort} name={t.copyCodeOf(c.code)} />
                      </div>
                    </td>
                    <td className="ref-who">
                      <Link to={`/admin/jugadores/${encodeURIComponent(c.owner)}`}>{c.owner}</Link>
                    </td>
                    <td className="ref-num">{t.uses(c.uses, c.maxUses)}</td>
                    <td className="ref-num">{fmt(c.rewarded)}</td>
                    <td className="ref-num">
                      {c.held > 0 ? (
                        <Link to={`?seccion=referidos&estado=${STATE_URL.held}&q=${encodeURIComponent(c.code)}`} aria-label={t.seeHeld(c.held, c.code)}>
                          {fmt(c.held)}
                        </Link>
                      ) : (
                        fmt(c.held)
                      )}
                    </td>
                    <td>
                      <span className={`admin-chip ref-chip ${TONE[state]}`}>{t.codeStates[state]}</span>
                    </td>
                    <td className="ref-when">{c.expiresAt ? day.format(new Date(c.expiresAt)) : t.never}</td>
                    <td className="ref-note">{c.note ?? '—'}</td>
                    <td className="ref-when">
                      <span className="ref-two">
                        <span>{cellText('createdAt', c.createdAt)}</span>
                        {c.createdBy ? <small>{t.by(c.createdBy)}</small> : null}
                      </span>
                    </td>
                    <td>
                      <div className="ref-actions">
                        <button type="button" className="lip pill small" aria-haspopup="dialog" aria-label={t.editOf(c.code)} onClick={() => show({ kind: 'edit', code: c })}>
                          <Icon name="wrench" />
                          <span>{t.edit}</span>
                        </button>
                        <button
                          type="button"
                          className={`lip pill small${c.enabled ? ' ref-off' : ''}`}
                          aria-haspopup="dialog"
                          aria-label={c.enabled ? t.turnOffOf(c.code) : t.turnOnOf(c.code)}
                          onClick={() => show({ kind: 'toggle', code: c })}
                        >
                          <Icon name={c.enabled ? 'lock' : 'play'} />
                          <span>{c.enabled ? t.turnOff : t.turnOn}</span>
                        </button>
                        <Link className="lip pill small" to={`?seccion=premios&dueno=${encodeURIComponent(c.owner)}`} aria-label={t.ownerRulesOf(c.owner)}>
                          <Icon name="trophy" />
                          <span>{t.ownerRules}</span>
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </HScroll>
      ) : null}
      {open?.kind === 'create' ? (
        <ActionDialog
          url="/admin/referrals/codes"
          title={t.create}
          submit={t.create}
          fields={[
            { name: 'owner', label: t.fields.owner, kind: 'text', hint: t.ownerHint },
            { name: 'code', label: t.fields.code, kind: 'text', optional: true, hint: t.codeHint },
            ...limitFields(),
          ]}
          password={() => false}
          valid={(v) =>
            usernameSchema.safeParse(v['owner']!.trim()).success &&
            (v['code']!.trim() === '' || referralCodeSchema.safeParse(v['code']).success) &&
            maxOk(v['maxUses']!) &&
            expiryOk(v['expiresAt']!)
          }
          build={(v) => ({
            owner: usernameSchema.parse(v['owner']!.trim()),
            ...(v['code']!.trim() ? { code: referralCodeSchema.parse(v['code']) } : {}),
            ...limits(v),
          })}
          errors={{ staff_target: t.staffOwner }}
          result={(r) => <Created code={String(r['code'])} />}
          onDone={() => setOpen(null)}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open?.kind === 'edit' ? (
        <ActionDialog
          url={`/admin/referrals/codes/${open.code.id}`}
          method="PUT"
          title={t.editOf(open.code.code)}
          submit={t.save}
          fields={limitFields(open.code)}
          password={() => false}
          valid={(v) => maxOk(v['maxUses']!) && expiryOk(v['expiresAt']!)}
          build={limits}
          onDone={() => {
            setOpen(null);
            setDone(true);
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open?.kind === 'toggle' ? (
        <ActionDialog
          url={`/admin/referrals/codes/${open.code.id}`}
          method="PUT"
          title={open.code.enabled ? t.turnOffOf(open.code.code) : t.turnOnOf(open.code.code)}
          submit={open.code.enabled ? t.turnOff : t.turnOn}
          intro={<p className="panel-note">{open.code.enabled ? t.turnOffIntro : t.turnOnIntro}</p>}
          password={() => false}
          build={() => ({ enabled: !open.code.enabled })}
          onDone={() => {
            setOpen(null);
            setDone(true);
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}
