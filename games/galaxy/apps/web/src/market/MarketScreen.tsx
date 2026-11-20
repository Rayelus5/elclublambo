import { FINISHES, MARKET_SORTS, type MarketListing, type MarketRules, type MarketSort, TIERS, type Tier } from '@galaxy/shared';
import { useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useGacha } from '../api/economy';
import { type MarketSearch, useMarket, useMarketOffers, useMyMarket } from '../api/market';
import { FilterSelect, phenomenonOptions, traitOptions } from '../collection/Filters';
import { WalletBar } from '../hub/WalletBar';
import { useTrades } from '../api/trades';
import { TradesTab } from '../trades/TradeBoard';
import { errorText, useMe } from '../auth/useMe';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';
import { useSettled } from '../ui/useSettled';
import { postUrl } from './art';
import { BuyDialog } from './BuyDialog';
import { ListingCard } from './ListingCard';
import { ListingSheet } from './ListingSheet';
import { MarketStatsView } from './MarketStatsView';
import { OfferDialog } from './OfferDialog';
import { OffersPanel } from './OffersPanel';
import { MyListings } from './MyListings';
import { SellPanel } from './SellPanel';
import { HomeLink } from '../ui/BackLink';

// The market (GDD §14.6, §14.7; DESIGN_SYSTEM §8 quattuordecies): Comprar, Vender, Mis anuncios and Trueques (M5c-2),
// each its own URL (?pestana=vender|mios|trueques). Everyone sees the listings; buying and selling need the trade gates, and a notice says why.

const t = copy.market;
type Tab = 'buy' | 'sell' | 'mine' | 'offers' | 'trades' | 'stats';
const SLUG: Record<Tab, string | null> = { buy: null, sell: 'vender', mine: 'mios', offers: 'ofertas', trades: 'trueques', stats: 'estadisticas' };
const tabOf = (slug: string | null): Tab =>
  slug === 'vender' ? 'sell' : slug === 'mios' ? 'mine' : slug === 'ofertas' ? 'offers' : slug === 'trueques' ? 'trades' : slug === 'estadisticas' ? 'stats' : 'buy';
const LABEL: Record<Tab, string> = { buy: t.tabs.buy, sell: t.tabs.sell, mine: t.tabs.mine, offers: t.tabs.offers, trades: copy.trades.tab, stats: t.tabs.stats };

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

type Range = { from: string; to: string };
const NO_RANGE: Range = { from: '', to: '' };
const num = (v: string) => (/^\d{1,10}$/.test(v.trim()) ? Number(v.trim()) : undefined);

/** A pair of number fields, from and to (levels, prices). */
function RangeField({ label, value, max, onChange }: { label: string; value: Range; max: number; onChange: (v: Range) => void }) {
  const id = useId();
  return (
    <fieldset className="market-range">
      <legend>{label}</legend>
      {(['from', 'to'] as const).map((end) => (
        <input
          key={end}
          id={`${id}-${end}`}
          type="number"
          inputMode="numeric"
          min={1}
          max={max}
          placeholder={t[end]}
          aria-label={t.rangeLabel(label, t[end])}
          value={value[end]}
          onChange={(e) => onChange({ ...value, [end]: e.target.value })}
        />
      ))}
    </fieldset>
  );
}

/**
 * Comprar (the owner, 2026-11-14: «profesional para 100.000 anuncios, con filtros y búsqueda»): the rarities as chips,
 * the search, the order and «Filtros» (finish, type, palette, phenomenon, level and price from and to); the cards, each
 * seen up close with its 3D card and powers; «Cargar más» goes on from where the page ended.
 */
function Shop({ gateId }: { gateId: string }) {
  const me = useMe().data;
  const coins = useGacha({ fresh: true }).data?.wallet.coins;
  const ids = useId();
  const [tier, setTier] = useState<Tier | ''>('');
  const [sort, setSort] = useState<MarketSort>('new');
  const [search, setSearch] = useState('');
  const [finish, setFinish] = useState<string | undefined>();
  const [type, setType] = useState<string | undefined>();
  const [palette, setPalette] = useState<string | undefined>();
  const [phenomenon, setPhenomenon] = useState<string | undefined>();
  const [level, setLevel] = useState<Range>(NO_RANGE);
  const [price, setPrice] = useState<Range>(NO_RANGE);
  const [open, setOpen] = useState(false);
  const q = useSettled(search.trim(), 300);
  const levels = useSettled(level, 300);
  const prices = useSettled(price, 300);
  const query: MarketSearch = {
    ...(tier ? { tier } : {}),
    ...(finish ? { finish: finish as MarketSearch['finish'] } : {}),
    ...(type ? { type } : {}),
    ...(palette ? { palette } : {}),
    ...(phenomenon ? { phenomenon } : {}),
    ...(num(levels.from) ? { minLevel: num(levels.from) } : {}),
    ...(num(levels.to) ? { maxLevel: num(levels.to) } : {}),
    ...(num(prices.from) ? { minPrice: num(prices.from) } : {}),
    ...(num(prices.to) ? { maxPrice: num(prices.to) } : {}),
    sort,
    ...(q ? { q } : {}),
  };
  const market = useMarket(query);
  const [buying, setBuying] = useState<MarketListing | null>(null);
  const [seeing, setSeeing] = useState<MarketListing | null>(null);
  const [offering, setOffering] = useState<MarketListing | null>(null);
  const pages = market.data?.pages ?? [];
  const rules = pages[0]?.rules;
  const listings = pages.flatMap((p) => p.listings);
  const active = [finish, type, palette, phenomenon, level.from || level.to, price.from || price.to].filter(Boolean).length;
  const clear = () => {
    setFinish(undefined);
    setType(undefined);
    setPalette(undefined);
    setPhenomenon(undefined);
    setLevel(NO_RANGE);
    setPrice(NO_RANGE);
  };
  const shortOf = (l: MarketListing) => (coins === undefined ? 0 : Math.max(0, l.price - coins));
  const canBuy = !!rules && rules.canTrade && rules.purchasesLeft > 0;
  return (
    <>
      {rules ? <Gate rules={rules} id={gateId} /> : null}
      <div className="market-toolbar" role="search" aria-label={t.searchArea}>
        <div className="market-chips" role="group" aria-label={t.filterTier}>
          {(['', ...TIERS] as const).map((x) => (
            <button key={x || 'all'} type="button" className="chip" aria-pressed={tier === x} data-tier={x || undefined} onClick={() => setTier(x)}>
              {x ? <i aria-hidden="true" /> : null}
              {x ? copy.tiers[x] : t.allTiers}
            </button>
          ))}
        </div>
        <label className="market-search">
          <span>{t.search}</span>
          <input type="search" value={search} maxLength={40} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <div className="market-filter">
          <label htmlFor={`${ids}-sort`}>{t.sortLabel}</label>
          <Select<MarketSort> id={`${ids}-sort`} value={sort} options={MARKET_SORTS.map((x) => ({ value: x, label: t.sorts[x] }))} onChange={setSort} />
        </div>
        <button type="button" className={`lip pill small market-filters-toggle${active > 0 ? ' on' : ''}`} aria-expanded={open} aria-controls={`${ids}-panel`} onClick={() => setOpen((o) => !o)}>
          <Icon name="sliders" />
          <span>{t.filtersCount(active)}</span>
        </button>
      </div>
      {open ? (
        <div id={`${ids}-panel`} className="lip panel market-panel">
          <FilterSelect label={copy.finishLabel} value={finish} options={FINISHES.map((f): [string, string] => [f, copy.finishes[f]])} onChange={setFinish} />
          <FilterSelect label={copy.traitNames['galaxy_type']!} value={type} options={traitOptions('galaxy_type')} onChange={setType} />
          <FilterSelect label={copy.traitNames['palette']!} value={palette} options={traitOptions('palette')} onChange={setPalette} />
          <FilterSelect label={copy.traitNames['phenomenon']!} value={phenomenon} options={phenomenonOptions()} onChange={setPhenomenon} />
          <RangeField label={t.level} value={level} max={10} onChange={setLevel} />
          <RangeField label={t.priceRange} value={price} max={1_000_000_000} onChange={setPrice} />
          {active > 0 ? (
            <button type="button" className="lip pill small" onClick={clear}>
              {t.clearFilters}
            </button>
          ) : null}
        </div>
      ) : null}
      {market.error ? (
        <p className="field-error" role="alert">
          {errorText(market.error, copy.errors)}
        </p>
      ) : null}
      {!market.data ? (
        <p className="planetarium-wait" role="status" aria-label={copy.loading}>
          ⠋⠙⠹
        </p>
      ) : listings.length === 0 ? (
        <div className="lip panel lb-empty">
          <p>{t.empty}</p>
        </div>
      ) : (
        <>
          <p className="market-shown">{t.shown(listings.length, !!market.hasNextPage)}</p>
          <ul className="market-grid">
            {listings.map((l) => (
              <ListingCard
                key={l.id}
                l={l}
                own={l.seller === me?.username}
                coins={coins}
                gateId={rules?.canTrade ? undefined : gateId}
                canBuy={canBuy}
                onBuy={() => setBuying(l)}
                onSee={() => setSeeing(l)}
              />
            ))}
          </ul>
        </>
      )}
      {rules && rules.canTrade && rules.purchasesLeft === 0 ? <p className="panel-note">{t.noPurchasesLeft}</p> : null}
      {market.hasNextPage ? (
        <button type="button" className="lip pill market-more" disabled={market.isFetchingNextPage} aria-busy={market.isFetchingNextPage || undefined} onClick={() => void market.fetchNextPage()}>
          {market.isFetchingNextPage ? t.moreLoading : t.more}
        </button>
      ) : null}
      {seeing ? (
        <ListingSheet
          l={seeing}
          own={seeing.seller === me?.username}
          canBuy={canBuy}
          short={shortOf(seeing)}
          // The purchase and the offer open over the preview; closing them comes back to it.
          onBuy={() => setBuying(seeing)}
          canOffer={!!rules && rules.canTrade && rules.offers.enabled && (rules.offers.openLeft > 0 || !!seeing.myOffer) && rules.offers.todayLeft > 0}
          onOffer={() => setOffering(seeing)}
          onClose={() => setSeeing(null)}
        />
      ) : null}
      {buying && coins !== undefined ? <BuyDialog l={buying} coins={coins} onClose={() => setBuying(null)} /> : null}
      {offering && rules && coins !== undefined ? (
        <OfferDialog
          l={offering}
          rules={rules}
          coins={coins}
          onClose={() => {
            setOffering(null);
            setSeeing(null);
          }}
        />
      ) : null}
    </>
  );
}

export function MarketScreen() {
  const [params] = useSearchParams();
  const tab = tabOf(params.get('pestana'));
  const gateId = useId();
  const mine = useMyMarket();
  const trades = useTrades();
  const wallet = useGacha().data?.wallet;
  // The coins held in my open offers, beside what I have.
  const held = useMarketOffers().data?.held ?? 0;
  return (
    <div className="screen-root market-root">
      <div className="market">
        <header className="collection-bar">
          <HomeLink>
            <Icon name="back" />
            <span>{t.back}</span>
          </HomeLink>
          <h1>{t.title}</h1>
          {/* What one has, where the commission used to be (it says it when selling): the owner, 2026-11-14. */}
          <div className="market-wallet" role="group" aria-label={t.wallet}>
            <WalletBar wallet={wallet} />
            {held > 0 ? (
              <Link to="/mercado?pestana=ofertas" className="market-held" aria-label={t.heldLabel(held)}>
                <Icon name="coin" />
                <span>{t.held(held)}</span>
              </Link>
            ) : null}
          </div>
        </header>
        <div className="market-banner" aria-hidden="true" style={postUrl ? { backgroundImage: `url(${postUrl})` } : undefined} />
        <nav className="tabs market-tabs" aria-label={t.tabsLabel}>
          {(['buy', 'sell', 'mine', 'offers', 'trades', 'stats'] as const).map((k) => (
            <Link key={k} to={SLUG[k] ? `/mercado?pestana=${SLUG[k]}` : '/mercado'} aria-current={k === tab ? 'page' : undefined}>
              {LABEL[k]}
            </Link>
          ))}
        </nav>
        {tab === 'buy' ? (
          <Shop gateId={gateId} />
        ) : tab === 'stats' ? (
          <MarketStatsView />
        ) : tab === 'offers' ? (
          mine.data ? (
            <OffersPanel rules={mine.data.rules} />
          ) : (
            <p className="planetarium-wait" role="status" aria-label={copy.loading}>
              ⠋⠙⠹
            </p>
          )
        ) : tab === 'trades' ? (
          trades.data ? (
            <>
              <Gate rules={trades.data.rules} id={gateId} />
              <TradesTab trades={trades.data} gateId={trades.data.rules.canTrade ? undefined : gateId} />
            </>
          ) : trades.error ? (
            <p className="field-error" role="alert">
              {errorText(trades.error, copy.errors)}
            </p>
          ) : (
            <p className="planetarium-wait" role="status" aria-label={copy.loading}>
              ⠋⠙⠹
            </p>
          )
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
