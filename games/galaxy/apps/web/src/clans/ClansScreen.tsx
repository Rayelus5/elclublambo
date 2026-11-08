import type { ClanCard } from '@galaxy/shared';
import { useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useClanAction, useClans, useMyClan } from '../api/clans';
import { useGacha } from '../api/economy';
import { errorText, useMe } from '../auth/useMe';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';
import { ClanEmblem } from './ClanEmblem';
import { CreateClanDialog } from './CreateClanDialog';

// The clans (GDD §14.3; DESIGN_SYSTEM §8 duodecies): one's own clan first, a search, «Crear clan» with its cost (off,
// with the reason, without the level or the coins), and every clan with its emblem, members and points, to join
// (open) or to ask to (closed).

const t = copy.clans;

/** The value after it stops changing for `ms`. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

function Card({ c, inClan, onJoin, busy }: { c: ClanCard; inClan: boolean; onJoin: (c: ClanCard) => void; busy: boolean }) {
  const full = c.members >= c.maxMembers;
  return (
    <li className="lip panel clan-card" data-color={c.color}>
      <Link to={`/clanes/${c.tag}`} className="clan-card-who">
        <ClanEmblem emblem={c.emblem} color={c.color} scale={2} />
        <span>
          <b>{c.name}</b>
          <span className="clan-tag">{c.tag}</span>
        </span>
      </Link>
      <p className="clan-card-meta">
        <span className={`clan-access-chip${c.open ? '' : ' closed'}`}>{c.open ? t.open : t.closed}</span>
        <span>{t.members(c.members, c.maxMembers)}</span>
        <span className="clan-card-score">{t.score(c.score)}</span>
      </p>
      {inClan ? null : (
        <button type="button" className="lip pill" disabled={busy || full} onClick={() => onJoin(c)}>
          {full ? t.full : c.open ? t.join : t.request}
        </button>
      )}
    </li>
  );
}

export function ClansScreen() {
  const me = useMe();
  const gacha = useGacha();
  const mine = useMyClan();
  const [q, setQ] = useState('');
  const clans = useClans(useSettled(q.trim(), 250));
  const join = useClanAction();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const reasonId = useId();
  const searchId = useId();
  const searchTitle = useId();

  const rules = clans.data?.rules;
  const level = me.data?.level ?? 1;
  const coins = gacha.data?.wallet.coins ?? 0;
  const inClan = Boolean(mine.data);
  const ready = rules && me.data && gacha.data && mine.isSuccess;
  const reason = !ready ? null : inClan ? t.inClan : level < rules.minLevel ? t.needLevel(rules.minLevel) : coins < rules.createCost.coins ? t.needCoins(rules.createCost.coins) : null;
  const error = errorText(join.error ?? clans.error, copy.errors);

  return (
    <div className="screen-root clans-root">
      <div className="clans">
        <header className="collection-bar">
          <Link to="/" className="lip pill">
            <Icon name="back" />
            <span>{t.back}</span>
          </Link>
          <h1>{t.title}</h1>
        </header>
        {mine.data ? (
          <Link to={`/clanes/${mine.data.tag}`} className="lip panel clan-mine">
            <ClanEmblem emblem={mine.data.emblem} color={mine.data.color} scale={2} />
            <span>
              <small>{t.yourClan}</small>
              <b>{mine.data.name}</b>
              <span className="clan-tag">{mine.data.tag}</span>
            </span>
          </Link>
        ) : null}
        <div className="clans-tools">
          <form role="search" aria-labelledby={searchTitle} className="clans-search" onSubmit={(e) => e.preventDefault()}>
            <span id={searchTitle} className="sr-only">
              {t.searchTitle}
            </span>
            <label htmlFor={searchId}>{t.searchLabel}</label>
            <input id={searchId} value={q} onChange={(e) => setQ(e.target.value)} maxLength={24} autoComplete="off" />
          </form>
          {ready ? (
            <div className="clans-create">
              <button type="button" className="lip pill pill-solar" disabled={reason !== null} aria-describedby={reason ? reasonId : undefined} onClick={() => setCreating(true)}>
                <Icon name="clan" />
                <span>{t.create}</span>
                <small>{t.cost(rules.createCost.coins)}</small>
              </button>
              {reason ? (
                <p id={reasonId} className="panel-note">
                  {reason}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        {clans.data ? (
          clans.data.clans.length === 0 ? (
            <p className="clans-empty">{q.trim() ? t.noResults : t.empty}</p>
          ) : (
            <ul className="clans-grid" aria-label={t.title}>
              {clans.data.clans.map((c) => (
                <Card
                  key={c.tag}
                  c={c}
                  inClan={inClan}
                  busy={join.isPending}
                  onJoin={(card) => join.mutate({ tag: card.tag, path: card.open ? 'join' : 'request' }, { onSuccess: () => navigate(`/clanes/${card.tag}`) })}
                />
              ))}
            </ul>
          )
        ) : clans.isPending ? (
          <p className="planetarium-wait" role="status" aria-label={copy.loading}>
            ⠋⠙⠹
          </p>
        ) : null}
        {creating && rules ? <CreateClanDialog cost={rules.createCost.coins} onClose={() => setCreating(false)} /> : null}
      </div>
    </div>
  );
}
