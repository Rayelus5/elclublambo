import { TIERS } from '@galaxy/shared';
import { useMarketStats } from '../api/market';
import { errorText } from '../auth/useMe';
import { copy, fmt } from '../copy/es';
import { Icon } from '../ui/Icon';

const t = copy.market.stats;
const time = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });

/**
 * The market in numbers (the owner, 2026-11-14: «estadísticas públicas del oro movido y de los intercambios»): the last
 * 24 hours and 7 days (sales, coins moved, the commission that left the economy, trades done), what is on sale now,
 * the week by rarity and its dearest sale. The server counts them every 5 minutes.
 */
export function MarketStatsView() {
  const stats = useMarketStats();
  const s = stats.data;
  if (stats.error)
    return (
      <p className="field-error" role="alert">
        {errorText(stats.error, copy.errors)}
      </p>
    );
  if (!s)
    return (
      <p className="planetarium-wait" role="status" aria-label={copy.loading}>
        ⠋⠙⠹
      </p>
    );
  const tile = (label: string, value: number, coin = false) => (
    <div className="stat-tile" role="group" aria-label={label}>
      <span className="stat-label">{label}</span>
      <b className="stat-value">
        {coin ? <Icon name="coin" /> : null}
        {fmt(value)}
      </b>
    </div>
  );
  return (
    <section className="market-stats" aria-labelledby="market-stats-title">
      <header className="market-stats-head">
        <h2 id="market-stats-title">{t.title}</h2>
        <p className="panel-note">{s.updatedAt ? t.updated(time.format(new Date(s.updatedAt))) : t.never}</p>
      </header>
      <h3>{t.day}</h3>
      <div className="stat-tiles">
        {tile(t.sales, s.day.sales)}
        {tile(t.gold, s.day.gold, true)}
        {tile(t.commission, s.day.commission, true)}
        {tile(t.active, s.active)}
      </div>
      <h3>{t.week}</h3>
      <div className="stat-tiles">
        {tile(t.sales, s.week.sales)}
        {tile(t.gold, s.week.gold, true)}
        {tile(t.commission, s.week.commission, true)}
        {tile(t.trades, s.week.trades)}
      </div>
      <h3>{t.byTier}</h3>
      <table className="admin-table market-stats-tiers">
        <thead>
          <tr>
            <th scope="col">{copy.market.filterTier}</th>
            <th scope="col">{t.tierSales}</th>
            <th scope="col">{t.tierAvg}</th>
          </tr>
        </thead>
        <tbody>
          {TIERS.map((tier) => {
            const row = s.byTier[tier];
            return (
              <tr key={tier} data-tier={tier}>
                <th scope="row">{copy.tiers[tier]}</th>
                <td>{row ? fmt(row.sales) : t.none}</td>
                <td>{row ? copy.market.price(row.avg) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {s.top ? (
        <p className="market-stats-top">
          <Icon name="trophy" />
          <span>
            <b>{t.top}</b> {t.topLine(s.top.name, copy.market.price(s.top.price))}
          </span>
        </p>
      ) : null}
    </section>
  );
}
