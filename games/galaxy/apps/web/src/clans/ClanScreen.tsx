import { type ClanAction, type ClanMember, type ClanRole, type ClanView, canManage } from '@galaxy/shared';
import { useId, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { useClan, useClanAction, useEditClan, useMyClan } from '../api/clans';
import { errorText, useMe } from '../auth/useMe';
import { copy, fmt } from '../copy/es';
import { useUi } from '../state/ui';
import { Avatar } from '../hub/Avatar';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { ClanEmblem } from './ClanEmblem';
import { EmblemPicker } from './CreateClanDialog';
import { BackLink } from '../ui/BackLink';

// A clan's page (GDD §14.3; DESIGN_SYSTEM §8 duodecies): its emblem, name, tag and description, its season standing,
// its members with what the viewer's role lets them do to each, the requests for the leader and the officers, and
// joining, asking, cancelling or leaving; members open the clan's chat (M5b-2). Expelling, handing over the leadership and leaving are confirmed first.

const t = copy.clans;
type MemberAction = Exclude<ClanAction, 'accept' | 'edit'>;
const SHORT: Record<MemberAction, string> = { promote: t.promoteShort, demote: t.demoteShort, transfer: t.transferShort, kick: t.kickShort };
const LABEL: Record<MemberAction, (u: string) => string> = { promote: t.promote, demote: t.demote, transfer: t.transfer, kick: t.kick };

type Pending = { kind: 'kick' | 'transfer'; username: string } | { kind: 'leave' } | null;

function Confirm({ pending, view, onConfirm, onClose, busy }: { pending: NonNullable<Pending>; view: ClanView; onConfirm: () => void; onClose: () => void; busy: boolean }) {
  const role = view.me && 'role' in view.me ? view.me.role : null;
  const alone = view.members.length === 1;
  const [title, body, cta] =
    pending.kind === 'kick'
      ? [t.kickTitle(pending.username), t.kickBody(view.kickHours), t.kickConfirm]
      : pending.kind === 'transfer'
        ? [t.transferTitle(pending.username), t.transferBody, t.transferConfirm]
        : [t.leaveTitle, alone ? t.disbandBody : role === 'leader' ? t.leaderLeaveBody : t.leaveBody, alone ? t.disband : t.leaveConfirm];
  return (
    <Dialog role="alertdialog" title={title} onClose={onClose} className="confirm">
      <p>{body}</p>
      <div className="confirm-actions">
        <button type="button" className="lip pill" onClick={onClose}>
          {t.cancel}
        </button>
        <button type="button" className="lip pill danger" disabled={busy} onClick={onConfirm}>
          {cta}
        </button>
      </div>
    </Dialog>
  );
}

function EditDialog({ view, onClose }: { view: ClanView; onClose: () => void }) {
  const edit = useEditClan();
  const [description, setDescription] = useState(view.description);
  const [emblem, setEmblem] = useState(view.emblem);
  const [color, setColor] = useState(view.color);
  const [open, setOpen] = useState(view.open);
  const descriptionId = useId();
  const countId = useId();
  return (
    <Dialog title={t.editTitle} onClose={onClose} className="clan-create">
      <form
        className="clan-form"
        onSubmit={(e) => {
          e.preventDefault();
          edit.mutate({ tag: view.tag, edit: { description: description.trim(), emblem, color, open } }, { onSuccess: onClose });
        }}
      >
        <div className="clan-form-row">
          <label htmlFor={descriptionId}>{t.description}</label>
          <textarea id={descriptionId} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={140} rows={2} aria-describedby={countId} />
          <small id={countId}>{t.count(description.length, 140)}</small>
        </div>
        <EmblemPicker emblem={emblem} color={color} onEmblem={setEmblem} onColor={setColor} />
        <label className="clan-access">
          <input type="checkbox" checked={!open} onChange={(e) => setOpen(!e.target.checked)} />
          <span>
            <b>{t.closed}</b>
            <small>{t.closedHint}</small>
          </span>
        </label>
        {edit.error ? (
          <p className="field-error" role="alert">
            {errorText(edit.error, copy.errors)}
          </p>
        ) : null}
        <div className="clan-form-actions">
          <button type="button" className="lip pill" onClick={onClose}>
            {t.cancel}
          </button>
          <button type="submit" className="lip pill pill-solar" disabled={edit.isPending}>
            {t.save}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function MemberRow({ m, myRole, me, onAct, busy }: { m: ClanMember; myRole: ClanRole | null; me: boolean; onAct: (a: MemberAction, u: string) => void; busy: boolean }) {
  const actions = (['promote', 'demote', 'transfer', 'kick'] as const).filter((a) => !me && myRole !== null && canManage(myRole, m.role, a));
  return (
    <tr className={me ? 'mine' : undefined} aria-current={me ? 'true' : undefined}>
      <th scope="row" className="lb-who">
        <Avatar name={m.username} avatar={m.avatar} frame={m.frame} />
        <Link to={`/perfil/${encodeURIComponent(m.username)}`}>{m.username}</Link>
        {me ? <span className="lb-you">{t.you}</span> : null}
      </th>
      <td>
        <span className={`clan-role ${m.role}`}>{t.roles[m.role]}</span>
      </td>
      <td className="lb-level">{fmt(m.level)}</td>
      <td className="lb-value">{t.score(m.points)}</td>
      <td className="clan-actions">
        {actions.map((a) => (
          <button key={a} type="button" className={`lip pill small${a === 'kick' ? ' danger' : ''}`} aria-label={LABEL[a](m.username)} disabled={busy} onClick={() => onAct(a, m.username)}>
            {SHORT[a]}
          </button>
        ))}
      </td>
    </tr>
  );
}

export function ClanScreen() {
  const { tag = '' } = useParams();
  const clan = useClan(tag.toUpperCase());
  const viewer = useMe().data?.username;
  const mine = useMyClan();
  const blockedId = useId();
  const act = useClanAction();
  const navigate = useNavigate();
  const openChat = useUi((s) => s.openChat);
  const [pending, setPending] = useState<Pending>(null);
  const [editing, setEditing] = useState(false);
  const requestsTitle = useId();
  const v = clan.data;
  const missing = clan.error instanceof ApiError && (clan.error.status === 404 || clan.error.status === 400);
  const myRole = v?.me && 'role' in v.me ? v.me.role : null;
  const requested = Boolean(v?.me && 'requested' in v.me);
  // Already in another clan: joining this one would fail, so it says why instead.
  const elsewhere = Boolean(v && !myRole && mine.data && mine.data.tag !== v.tag);
  const full = Boolean(v && v.members.length >= v.maxMembers);
  const joinButton = (label: string) =>
    v ? (
      <>
        <button type="button" className="lip pill pill-solar" disabled={act.isPending || full || elsewhere} aria-describedby={elsewhere ? blockedId : undefined} onClick={() => send(v.open ? 'join' : 'request')}>
          {label}
        </button>
        {elsewhere ? (
          <span id={blockedId} className="panel-note">
            {t.inOtherClan}
          </span>
        ) : null}
      </>
    ) : null;
  const send = (path: string, after?: () => void) => v && act.mutate({ tag: v.tag, path }, { onSuccess: () => after?.() });

  function confirm(): void {
    if (!pending || !v) return;
    if (pending.kind === 'leave') send('leave', () => navigate('/clanes'));
    else send(`members/${pending.username}/${pending.kind}`);
    setPending(null);
  }

  return (
    <div className="screen-root clans-root">
      <div className="clans">
        <header className="collection-bar">
          <BackLink fallback="/clanes" />
        </header>
        {missing ? (
          <div className="lip panel lb-empty">
            <p>{copy.errors.clan_not_found}</p>
          </div>
        ) : null}
        {act.error || (clan.error && !missing) ? (
          <p className="field-error" role="alert">
            {errorText(act.error ?? clan.error, copy.errors)}
          </p>
        ) : null}
        {v ? (
          <>
            <section className="clan-head">
              <ClanEmblem emblem={v.emblem} color={v.color} scale={2} />
              <div>
                <h1>{v.name}</h1>
                <p className="clan-head-meta">
                  <span className="clan-tag">{v.tag}</span>
                  <span className={`clan-access-chip${v.open ? '' : ' closed'}`}>{v.open ? t.open : t.closed}</span>
                  <span>{t.members(v.members.length, v.maxMembers)}</span>
                </p>
                {v.description ? <p className="clan-description">{v.description}</p> : null}
                <p className="clan-standing">
                  <b>{t.score(v.score)}</b>
                  <span>{v.rank ? t.rank(v.rank) : t.noRank}</span>
                </p>
              </div>
              <div className="clan-head-actions">
                {myRole ? (
                  <button type="button" className="lip pill" aria-haspopup="dialog" onClick={() => openChat('clan')}>
                    <Icon name="chat" />
                    <span>{t.chat}</span>
                  </button>
                ) : null}
                {myRole === 'leader' ? (
                  <button type="button" className="lip pill" onClick={() => setEditing(true)}>
                    <Icon name="gear" />
                    <span>{t.edit}</span>
                  </button>
                ) : null}
                {myRole ? (
                  <button type="button" className="lip pill danger" onClick={() => setPending({ kind: 'leave' })}>
                    <Icon name="exit" />
                    <span>{t.leave}</span>
                  </button>
                ) : requested ? (
                  <>
                    <span className="clan-requested">{t.requested}</span>
                    <button type="button" className="lip pill" disabled={act.isPending} onClick={() => send('request/cancel')}>
                      {t.cancelRequest}
                    </button>
                    {/* The clan opened since: joining needs no answer now. */}
                    {v.open ? joinButton(t.join) : null}
                  </>
                ) : (
                  joinButton(full ? t.full : v.open ? t.join : t.request)
                )}
              </div>
            </section>
            {v.requests !== undefined ? (
              <section className="lip panel clan-requests" aria-labelledby={requestsTitle}>
                <h2 id={requestsTitle}>{t.requestsTitle}</h2>
                {v.requests.length === 0 ? (
                  <p className="panel-note">{t.noRequests}</p>
                ) : (
                  <ul>
                    {v.requests.map((u) => (
                      <li key={u}>
                        <Avatar name={u} />
                        <Link to={`/perfil/${encodeURIComponent(u)}`}>{u}</Link>
                        <button type="button" className="lip pill small pill-solar" aria-label={t.accept(u)} disabled={act.isPending} onClick={() => send(`requests/${u}/accept`)}>
                          {t.acceptShort}
                        </button>
                        <button type="button" className="lip pill small" aria-label={t.reject(u)} disabled={act.isPending} onClick={() => send(`requests/${u}/reject`)}>
                          {t.rejectShort}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}
            <table className="lip panel lb-table clan-members" aria-label={t.membersTitle}>
              <thead>
                <tr>
                  <th scope="col">{t.columns.member}</th>
                  <th scope="col">{t.columns.role}</th>
                  <th scope="col">{t.columns.level}</th>
                  <th scope="col">{t.columns.points}</th>
                  <th scope="col">
                    <span className="sr-only">{t.columns.actions}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {v.members.map((m) => (
                  <MemberRow
                    key={m.username}
                    m={m}
                    myRole={myRole}
                    me={m.username === viewer}
                    busy={act.isPending}
                    onAct={(a, u) => (a === 'kick' || a === 'transfer' ? setPending({ kind: a, username: u }) : send(`members/${u}/${a}`))}
                  />
                ))}
              </tbody>
            </table>
          </>
        ) : clan.isPending ? (
          <p className="planetarium-wait" role="status" aria-label={copy.loading}>
            ⠋⠙⠹
          </p>
        ) : null}
        {pending && v ? <Confirm pending={pending} view={v} busy={act.isPending} onClose={() => setPending(null)} onConfirm={confirm} /> : null}
        {editing && v ? <EditDialog view={v} onClose={() => setEditing(false)} /> : null}
      </div>
    </div>
  );
}
