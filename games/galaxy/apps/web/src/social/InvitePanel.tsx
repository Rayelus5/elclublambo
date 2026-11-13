import { useId } from 'react';
import { useMyReferrals } from '../api/referrals';
import { copy, fmt } from '../copy/es';
import { codeState, giftsText, inviteLink } from '../referrals/invite';
import { CopyButton } from '../ui/CopyButton';

// «Tu código de invitación» on the player's own profile (plan «referidos», part R2): only for the veterans the team gave
// a code to (nobody else ever sees it). Each code with its code and link to copy (or why it no longer works), how many
// came in, are waiting for the level or were rewarded, and what both get: the server's numbers, the owner's own ones
// when the team set them.

const t = copy.invite;
const day = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

/** The owner's own codes on their profile; nothing at all for a player without one. */
export function InvitePanel() {
  const id = useId();
  const mine = useMyReferrals(true);
  const m = mine.data;
  if (!m || m.codes.length === 0) return null;
  return (
    <section className="lip panel profile-panel profile-invite" aria-labelledby={id}>
      <h2 id={id}>{t.title(m.codes.length)}</h2>
      <p className="profile-invite-intro">{t.intro}</p>
      <ul className="invite-codes">
        {m.codes.map((c) => {
          const state = codeState(c);
          return (
            <li key={c.code} className={state === 'on' ? undefined : 'is-off'}>
              <div className="invite-code-head">
                <b className="invite-code">{c.code}</b>
                {state !== 'on' ? <span className="invite-state">{t.states[state]}</span> : null}
              </div>
              {c.maxUses !== null || c.expiresAt ? (
                <p className="invite-limits">{[c.maxUses !== null ? t.uses(c.uses, c.maxUses) : null, c.expiresAt ? t.expires(day.format(new Date(c.expiresAt))) : null].filter(Boolean).join('. ')}</p>
              ) : null}
              {state === 'on' ? (
                <div className="invite-actions">
                  <CopyButton text={c.code} label={t.copyCode} name={t.copyCodeOf(c.code)} />
                  <CopyButton text={inviteLink(c.code)} label={t.copyLink} name={t.copyLinkOf(c.code)} />
                </div>
              ) : (
                <p className="invite-limits">{t.unusable}</p>
              )}
            </li>
          );
        })}
      </ul>
      <dl className="profile-facts">
        {(
          [
            [t.joined, m.joined],
            [t.waiting, m.waiting],
            [t.rewarded, m.rewarded],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{fmt(value)}</dd>
          </div>
        ))}
      </dl>
      <ul className="invite-gifts">
        <li>{t.newcomerGets(giftsText(m.newcomerGifts, t.nothing))}</li>
        <li>{t.youGet(m.activationLevel, giftsText(m.ownerGifts, t.nothing))}</li>
      </ul>
    </section>
  );
}
