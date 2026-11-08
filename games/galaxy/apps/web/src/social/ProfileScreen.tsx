import { type Profile, TIERS } from '@galaxy/shared';
import { useId, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { useProfile } from '../api/social';
import { errorText, useMe } from '../auth/useMe';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy, fmt } from '../copy/es';
import { Avatar } from '../hub/Avatar';
import { Icon } from '../ui/Icon';
import { ClanEmblem } from '../clans/ClanEmblem';
import { TierEmblem } from './parts';
import { useTrades } from '../api/trades';
import { TradeComposer } from '../trades/TradeComposer';

// A player's public profile (GDD §14.2, §12.1; DESIGN_SYSTEM §8 undecies): their name, level and since when; this
// season with its tier; their records; their collection by rarity with a way into it; their planetarium with a way
// to visit it. Nothing private.

const t = copy.social;

function Panel({ title, className, children }: { title: string; className: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section className={`lip panel profile-panel ${className}`} aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

function Facts({ items }: { items: [string, number][] }) {
  return (
    <dl className="profile-facts">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{fmt(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Body({ p }: { p: Profile }) {
  const who = encodeURIComponent(p.username);
  return (
    <div className="profile-grid">
      <Panel title={t.seasonTitle} className="profile-season">
        {p.season ? (
          <>
            <div className="profile-tier">
              {p.season.tier ? <TierEmblem tier={p.season.tier} scale={2} /> : null}
              <b>{p.season.tier ? t.tier[p.season.tier] : t.noTier}</b>
            </div>
            <Facts
              items={[
                [t.score, p.season.score],
                [t.columns.rank, p.season.rank],
                [t.maxDepth, p.season.maxDepth],
                [t.purges, p.season.purges],
                [t.extractions, p.season.extractions],
              ]}
            />
          </>
        ) : (
          <p className="profile-empty">{t.noSeason}</p>
        )}
      </Panel>
      <Panel title={t.records} className="profile-records">
        <Facts
          items={[
            [t.maxDepth, p.records.maxDepth],
            [t.purges, p.records.purges],
            [t.runs, p.records.runs],
          ]}
        />
      </Panel>
      <Panel title={t.collectionTitle} className="profile-collection">
        <p className="profile-total">{copy.hub.galaxies(p.collection.total)}</p>
        <ul className="tier-counts" aria-label={copy.hub.byTier}>
          {[...TIERS].reverse().map((tier) => (
            <li key={tier} data-tier={tier} className={p.collection.counts[tier] ? undefined : 'none'}>
              <i aria-hidden="true" />
              <b>{fmt(p.collection.counts[tier])}</b>
              <span>{copy.tiers[tier]}</span>
            </li>
          ))}
        </ul>
        <Link to={`/perfil/${who}/coleccion`} className="lip pill">
          <Icon name="cards" />
          <span>{t.seeCollection}</span>
        </Link>
      </Panel>
      <Panel title={copy.planetarium.title} className="profile-planetarium">
        {p.planetarium.cover ? (
          <div className="profile-cover">
            <GalaxyCard galaxy={p.planetarium.cover} size={132} />
            <span>
              <b>{t.prestige(p.planetarium.prestige)}</b>
              <span>{t.exhibits(p.planetarium.exhibits)}</span>
            </span>
          </div>
        ) : (
          <p className="profile-empty">{t.noExhibits}</p>
        )}
        <Link to={`/planetario/${who}`} className="lip pill pill-solar">
          <Icon name="compass" />
          <span>{t.visitPlanetarium}</span>
        </Link>
      </Panel>
    </div>
  );
}

export function ProfileScreen() {
  const { username = '' } = useParams();
  const profile = useProfile(username);
  const viewer = useMe().data?.username;
  const navigate = useNavigate();
  const [proposing, setProposing] = useState(false);
  const trades = useTrades();
  const p = profile.data;
  const missing = profile.error instanceof ApiError && (profile.error.status === 404 || profile.error.status === 400);
  return (
    <div className="screen-root profile-root">
      <div className="profile">
        <header className="collection-bar">
          <Link to="/" className="lip pill">
            <Icon name="back" />
            <span>{t.back}</span>
          </Link>
        </header>
        {missing ? (
          <div className="lip panel lb-empty">
            <p>{copy.errors.profile_not_found}</p>
            <Link to="/clasificacion" className="lip pill">
              <Icon name="podium" />
              <span>{t.seeAll}</span>
            </Link>
          </div>
        ) : profile.error ? (
          <p className="field-error" role="alert">
            {errorText(profile.error, copy.errors)}
          </p>
        ) : null}
        {p ? (
          <>
            <section className="profile-head">
              <span className="profile-avatar">
                <Avatar name={p.username} />
              </span>
              <div>
                <h1>{p.username}</h1>
                <p className="profile-level">{t.level(p.level)}</p>
                <p className="profile-since">{t.since(p.since)}</p>
                {p.clan ? (
                  <Link to={`/clanes/${p.clan.tag}`} className="profile-clan">
                    <ClanEmblem emblem={p.clan.emblem} color={p.clan.color} scale={1} />
                    <span>{p.clan.name}</span>
                    <span className="clan-tag">{p.clan.tag}</span>
                  </Link>
                ) : null}
              </div>
            </section>
            {viewer && viewer !== p.username ? (
              <div className="profile-actions">
                <button type="button" className="lip pill pill-solar" aria-haspopup="dialog" onClick={() => setProposing(true)}>
                  <Icon name="flip" />
                  <span>{copy.trades.propose}</span>
                </button>
              </div>
            ) : null}
            {proposing ? (
              <TradeComposer
                username={p.username}
                days={trades.data?.rules.tradeDays ?? 3}
                onDone={() => navigate('/mercado?pestana=trueques')}
                onClose={() => setProposing(false)}
              />
            ) : null}
            <Body p={p} />
          </>
        ) : profile.isPending ? (
          <p className="planetarium-wait" role="status" aria-label={copy.loading}>
            ⠋⠙⠹
          </p>
        ) : null}
      </div>
    </div>
  );
}
