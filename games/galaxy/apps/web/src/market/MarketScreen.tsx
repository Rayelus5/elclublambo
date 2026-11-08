import { type MarketListing, type MarketRules, type MarketSort, TIERS, type Tier } from '@galaxy/shared';
import { useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useGacha } from '../api/economy';
import { useMarket, useMyMarket } from '../api/market';
import { errorText, useMe } from '../auth/useMe';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';
import { useSettled } from '../ui/useSettled';
import { postUrl } from './art';
import { BuyDialog } from './BuyDialog';
import { ListingCard } from './ListingCard';
import { MyListings } from './MyListings';
import { SellPanel } from './SellPanel';

// The market (GDD §14.6, §14.7; DESIGN_SYSTEM §8 quattuordecies): Comprar, Vender and Mis anuncios, each its own URL
// (?pestana=vender|mios). Everyone sees the listings; buying and selling need the trade gates, and a notice says why.

const t = copy.market;
type Tab = 'buy' | 'sell' | 'mine';
const SLUG: Record<Tab, string | null> = { buy: null, sell: 'vender', mine: 'mios' };
const tabOf = (slug: string | null): Tab => (slug === 'vender' ? 'sell' : slug === 'mios' ? 'mine' : 'buy');

function Gate({ rules, id }: { rules: MarketRules; id: string }) {
  if (rules.canTrade) return null;
  return (
    <div className="lip panel market-gate" id={id}>
      <Icon name="lock" />
      <div>
        <p>{t.gate(rules.minLevel, rules.minAccountDays)}</p>
        <p className="panel-note">{rules.reason === 'level' ? t.gateLevel : t.gateAge}</p>
      </div>
    </div>
  );
}

function Shop({ gateId }: { gateId: string }) {
  const me = useMe().data;
  const coins = useGacha().data?.wallet.coins;
  const [tier, setTier] = useState<Tier | ''>('');
  const [sort, setSort] = useState<MarketSort>('new');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useSettled(search.trim(), 300);
  const market = useMarket({ ...(tier ? { tier } : {}), sort, ...(q ? { q } : {}), page });
  const [buying, setBuying] = useState<MarketListing | null>(null);
  const v = market.data;
  const reset = () => setPage(1);
  return (
    <>
      {v ? <Gate rules={v.rules} id={gateId} /> : null}
      <div className="market-filters">
        <label>
          <span>{t.filterTier}</span>
          <select
            value={tier}
            onChange={(e) => {
              setTier(e.target.value as Tier | '');
              reset();
            }}
          >
            <option value="">{t.allTiers}</option>
            {TIERS.map((x) => (
              <option key={x} value={x}>
                {copy.tiers[x]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t.sortLabel}</span>
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as MarketSort);
              reset();
            }}
          >
            {(['new', 'cheap', 'dear'] as const).map((x) => (
              <option key={x} value={x}>
                {t.sorts[x]}
              </option>
            ))}
          </select>
        </label>
        <label className="market-search">
          <span>{t.search}</span>
          <input
            type="search"
            value={search}
            maxLength={40}
            onChange={(e) => {
              setSearch(e.target.value);
              reset();
            }}
          />
        </label>
      </div>
      {market.error ? (
        <p className="field-error" role="alert">
          {errorText(market.error, copy.errors)}
        </p>
      ) : null}
      {!v ? (
        <p className="planetarium-wait" role="status" aria-label={copy.loading}>
          ⠋⠙⠹
        </p>
      ) : v.listings.length === 0 ? (
        <div className="lip panel lb-empty">
          <p>{t.empty}</p>
        </div>
      ) : (
        <ul className="market-grid">
          {v.listings.map((l) => (
            <ListingCard
              key={l.id}
              l={l}
              own={l.seller === me?.username}
              coins={coins}
              gateId={v.rules.canTrade ? undefined : gateId}
              canBuy={v.rules.canTrade && v.rules.purchasesLeft > 0}
              onBuy={() => setBuying(l)}
            />
          ))}
        </ul>
      )}
      {v && v.rules.canTrade && v.rules.purchasesLeft === 0 ? <p className="panel-note">{t.noPurchasesLeft}</p> : null}
      {v && v.pages > 1 ? (
        <nav className="market-pages" aria-label={t.pageOf(v.page, v.pages)}>
          <button type="button" className="lip pill small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t.prev}
          </button>
          <span>{t.pageOf(v.page, v.pages)}</span>
          <button type="button" className="lip pill small" disabled={page >= v.pages} onClick={() => setPage((p) => p + 1)}>
            {t.next}
          </button>
        </nav>
      ) : null}
      {buying && coins !== undefined ? <BuyDialog l={buying} coins={coins} onClose={() => setBuying(null)} /> : null}
    </>
  );
}

export function MarketScreen() {
  const [params] = useSearchParams();
  const tab = tabOf(params.get('pestana'));
  const gateId = useId();
  const mine = useMyMarket();
  return (
    <div className="screen-root market-root">
      <div className="market">
        <header className="collection-bar">
          <Link to="/" className="lip pill">
            <Icon name="back" />
            <span>{t.back}</span>
          </Link>
          <h1>{t.title}</h1>
          {mine.data ? <p className="market-commission">{t.commission(Math.round(mine.data.rules.commission * 100))}</p> : null}
        </header>
        <div className="market-banner" aria-hidden="true" style={postUrl ? { backgroundImage: `url(${postUrl})` } : undefined} />
        <nav className="tabs market-tabs" aria-label={t.tabsLabel}>
          {(['buy', 'sell', 'mine'] as const).map((k) => (
            <Link key={k} to={SLUG[k] ? `/mercado?pestana=${SLUG[k]}` : '/mercado'} aria-current={k === tab ? 'page' : undefined}>
              {t.tabs[k]}
            </Link>
          ))}
        </nav>
        {tab === 'buy' ? (
          <Shop gateId={gateId} />
        ) : !mine.data ? (
          mine.error ? (
            <p className="field-error" role="alert">
              {errorText(mine.error, copy.errors)}
            </p>
          ) : (
            <p className="planetarium-wait" role="status" aria-label={copy.loading}>
              ⠋⠙⠹
            </p>
          )
        ) : (
          <>
            <Gate rules={mine.data.rules} id={gateId} />
            {tab === 'sell' ? (
              <SellPanel rules={mine.data.rules} preselected={params.get('galaxia')} gateId={mine.data.rules.canTrade ? undefined : gateId} />
            ) : (
              <MyListings mine={mine.data} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
