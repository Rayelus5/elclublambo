import { TIERS, type BannerView, type PulledGalaxy, type PullRequest } from '@galaxy/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { useGacha, usePull } from '../api/economy';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { WalletBar } from '../hub/WalletBar';
import { Icon } from '../ui/Icon';
import { RevealStage } from './RevealStage';
import { BackLink } from '../ui/BackLink';
import { emitTour } from '../tour/bus';

// The deep scan (GDD §9): everything the player needs to decide is visible BEFORE paying — the odds of each tier on
// the next scan (rising luck included), how far the guaranteed Legendary is, the welcome luck — then scan with the
// daily free scan, signals or coins. The server rolls; this screen only asks and plays the reveal.
const day = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
const traitNames = copy.traitNames;
const traitValues = copy.traitValues as Record<string, Record<string, string>>;

function Odds({ banner }: { banner: BannerView }) {
  const total = banner.sinceLegendary + banner.untilGuarantee;
  return (
    <div className="odds" data-tour="odds">
      <table aria-label={copy.scanner.odds}>
        <caption>{copy.scanner.odds}</caption>
        <tbody>
          {[...TIERS].reverse().map((t) => (
            <tr key={t} data-tier={t}>
              <th scope="row">
                <i aria-hidden="true" />
                {copy.tiers[t]}
              </th>
              <td>{copy.scanner.rate(banner.nextRates[TIERS.indexOf(t)] ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pity" data-tour="pity">
        <div className="pity-head">
          <b>{copy.scanner.untilGuarantee(banner.untilGuarantee)}</b>
          <span>{copy.scanner.sinceLegendary(banner.sinceLegendary)}</span>
        </div>
        <div className="pity-bar" aria-hidden="true">
          <i style={{ width: `${total > 0 ? Math.round((banner.sinceLegendary / total) * 100) : 0}%` }} />
        </div>
        {banner.featured ? (
          <p className="pity-featured">
            {copy.scanner.featured(traitNames[banner.featured.trait] ?? banner.featured.trait, traitValues[banner.featured.trait]?.[banner.featured.value] ?? banner.featured.value)}
            {banner.untilFeatured !== undefined ? <span>{copy.scanner.untilFeatured(banner.untilFeatured)}</span> : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PullButton({ count, cost, disabled, onClick, solar, tour }: { count: 1 | 10; cost: string; disabled: boolean; onClick: () => void; solar?: boolean; tour?: string }) {
  return (
    <button type="button" className={`lip pull-btn ${solar ? 'solar' : ''}`} disabled={disabled} onClick={onClick} data-tour={tour}>
      <b>{copy.scanner.pull(count)}</b>
      <span>{cost}</span>
    </button>
  );
}

export function ScannerScreen() {
  const gacha = useGacha();
  const pull = usePull();
  const [bannerId, setBannerId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<PulledGalaxy[] | null>(null);
  const view = gacha.data;
  const banner = view?.banners.find((b) => b.id === bannerId) ?? view?.banners[0];
  const wallet = view?.wallet;

  function scan(count: 1 | 10, pay: PullRequest['pay']): void {
    if (!banner) return;
    pull.mutate(
      { banner: banner.id, count, pay },
      {
        onSuccess: (res) => {
          setRevealed(res.pulls);
          emitTour('scanner:pulled');
        },
      },
    );
  }

  const busy = pull.isPending;
  // The standard signals, or an event scanner's own (M7e-1).
  const signals = banner ? (wallet?.[banner.currency] ?? 0) : 0;
  return (
    <div className="screen-root collection-root scanner-root">
      <div className="collection scanner">
        <header className="collection-bar">
          <BackLink fallback="/" />
          <h1>{copy.scanner.title}</h1>
          <div className="lip panel hud">
            <WalletBar wallet={wallet} />
          </div>
        </header>

        {view && view.banners.length > 1 ? (
          <div className="segmented banners" role="group" aria-label={copy.scanner.title}>
            {view.banners.map((b) => (
              <button key={b.id} type="button" aria-pressed={b.id === banner?.id} onClick={() => setBannerId(b.id)}>
                {b.name}
              </button>
            ))}
          </div>
        ) : null}

        {banner && view ? (
          <main className="scanner-main">
            <section className="lip panel scanner-terminal" aria-labelledby="banner-name">
              <div className="crt idle" aria-hidden="true">
                <div className="crt-screen">
                  <span className="idle-braille">⠎⠉⠁⠝</span>
                  <span className="idle-text">{copy.scanner.ready}</span>
                </div>
              </div>
              <div className="banner-head">
                <h2 id="banner-name">{banner.name}</h2>
                {banner.welcome ? <span className="badge-new">{copy.scanner.welcome}</span> : null}
                {banner.endsAt ? <span className="banner-ends">{copy.scanner.endsAt(day.format(new Date(banner.endsAt)))}</span> : null}
              </div>
            </section>

            <aside className="lip panel scanner-side">
              <Odds banner={banner} />
              {pull.isError ? (
                <p className="summary error" role="alert">
                  <Icon name="alert" />
                  <span>{errorText(pull.error, copy.errors)}</span>
                </p>
              ) : null}
              {view.freePullAvailable && banner.kind === 'standard' ? (
                <button type="button" className="lip pull-free" disabled={busy} onClick={() => scan(1, 'free')}>
                  <Icon name="radar" />
                  <span>
                    <b>{copy.scanner.free}</b>
                    <span>{copy.scanner.freeHint}</span>
                  </span>
                </button>
              ) : null}
              {banner.currency === 'signal' || banner.currency.startsWith('signal:') ? (
                <div className="pull-row">
                  <span className="pull-label">{banner.currency === 'signal' ? copy.scanner.withSignals : copy.scanner.withEventSignals(signals)}</span>
                  <PullButton count={1} cost={copy.scanner.costSignals(view.costs.signals)} disabled={busy || signals < view.costs.signals} onClick={() => scan(1, 'signal')} solar />
                  <PullButton count={10} cost={copy.scanner.costSignals(view.costs.signals * 10)} disabled={busy || signals < view.costs.signals * 10} onClick={() => scan(10, 'signal')} solar tour="pull10" />
                </div>
              ) : null}
              <div className="pull-row">
                <span className="pull-label">{copy.scanner.withCoins}</span>
                <PullButton count={1} cost={copy.scanner.costCoins(view.costs.coins)} disabled={busy || (wallet?.coins ?? 0) < view.costs.coins} onClick={() => scan(1, 'coins')} />
                <PullButton count={10} cost={copy.scanner.costCoins(view.costs.coinsTen)} disabled={busy || (wallet?.coins ?? 0) < view.costs.coinsTen} onClick={() => scan(10, 'coins')} />
              </div>
            </aside>
          </main>
        ) : gacha.isError ? (
          <p className="summary error" role="alert">
            <Icon name="alert" />
            <span>{errorText(gacha.error, copy.errors)}</span>
          </p>
        ) : (
          <p className="collection-wait" aria-hidden="true">
            ⠋⠙⠹
          </p>
        )}
      </div>

      {revealed ? (
        <RevealStage
          pulls={revealed}
          onClose={() => {
            setRevealed(null);
            emitTour('scanner:revealClosed');
          }}
          actions={
            <Link to="/coleccion" className="lip pill pill-solar">
              <Icon name="cards" />
              <span>{copy.scanner.toCollection}</span>
            </Link>
          }
        />
      ) : null}
    </div>
  );
}
