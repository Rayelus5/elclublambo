import { TIERS, type BannerView, type PulledGalaxy, type PullRequest } from '@galaxy/shared';
import { useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useGacha, usePull } from '../api/economy';
import { errorText } from '../auth/useMe';
import { copy, fmt } from '../copy/es';
import { eventSignals, WalletBar } from '../hub/WalletBar';
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
      </div>
    </div>
  );
}

/**
 * An event scanner's featured galaxy, announced big (open beta): the trait in large letters, how many scans until it
 * is certain (the number set apart) and the way already walked towards it.
 */
function FeaturedCard({ banner }: { banner: BannerView }) {
  const id = useId();
  const f = banner.featured!;
  const until = banner.untilFeatured;
  const every = banner.featuredEvery;
  const sentence = until !== undefined ? copy.scanner.untilFeatured(until) : null;
  const num = until !== undefined ? fmt(until) : '';
  const parts = sentence && sentence.includes(num) ? sentence.split(num) : null;
  return (
    <section className="scan-featured" aria-labelledby={id}>
      <span className="scan-featured-shine" aria-hidden="true" />
      <div className="scan-featured-main">
        <p className="scan-featured-kicker">
          <Icon name="starOn" />
          <span id={id}>{copy.scanner.featuredTitle}</span>
        </p>
        <p className="scan-featured-value">{traitValues[f.trait]?.[f.value] ?? f.value}</p>
        <p className="scan-featured-trait">
          <span>{traitNames[f.trait] ?? f.trait}</span>
          <span>{copy.scanner.featuredHint}</span>
        </p>
      </div>
      {sentence ? (
        <div className="scan-featured-pity">
          <p className="scan-featured-count">
            {parts ? (
              <>
                {parts[0]}
                <b>{num}</b>
                {parts.slice(1).join(num)}
              </>
            ) : (
              sentence
            )}
          </p>
          {every && until !== undefined ? (
            <div className="scan-featured-bar" role="progressbar" aria-label={copy.scanner.featuredProgress} aria-valuemin={0} aria-valuemax={every} aria-valuenow={Math.max(0, every - until)}>
              <i style={{ width: `${Math.round((Math.max(0, every - until) / every) * 100)}%` }} />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function PullButton({ count, cost, disabled, onClick, solar, event, tour }: { count: 1 | 10; cost: string; disabled: boolean; onClick: () => void; solar?: boolean; event?: boolean; tour?: string }) {
  return (
    <button type="button" className={`lip pull-btn${solar ? ' solar' : ''}${event ? ' pull-event' : ''}`} disabled={disabled} onClick={onClick} data-tour={tour}>
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
  // `?tipo=evento` (from the event's missions tab) opens on the event scanner.
  const [params] = useSearchParams();
  const view = gacha.data;
  const wanted = params.get('tipo') === 'evento' ? view?.banners.find((b) => b.kind === 'event') : undefined;
  const banner = view?.banners.find((b) => b.id === bannerId) ?? wanted ?? view?.banners[0];
  const isEvent = banner?.kind === 'event';
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
      <div className={`collection scanner${isEvent ? ' is-event' : ''}`}>
        <header className="collection-bar">
          <BackLink fallback="/" />
          <h1>{isEvent ? copy.scanner.eventTab : copy.scanner.title}</h1>
          <div className="lip panel hud">
            <WalletBar wallet={wallet} />
          </div>
        </header>

        {view && view.banners.length > 1 ? (
          <div className="scanner-tabs" role="group" aria-label={copy.scanner.title}>
            {view.banners.map((b) => (
              <button key={b.id} type="button" className={`lip scanner-tab tab-${b.kind}`} aria-pressed={b.id === banner?.id} onClick={() => setBannerId(b.id)}>
                <Icon name={b.kind === 'event' ? 'starOn' : 'radar'} />
                <span className="scanner-tab-name">{b.kind === 'event' ? copy.scanner.eventTab : b.name}</span>
                {b.kind === 'event' ? (
                  <span className="scanner-tab-badge">
                    <Icon name="ticket" />
                    <b aria-hidden="true">{wallet?.[b.currency] ?? eventSignals(wallet)}</b>
                    <span className="sr-only">{copy.hub.resource.eventSignal(wallet?.[b.currency] ?? eventSignals(wallet))}</span>
                  </span>
                ) : null}
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
                <h2 id="banner-name">{isEvent ? copy.scanner.eventTab : banner.name}</h2>
                {isEvent ? <span className="banner-sub">{banner.name}</span> : null}
                {banner.welcome ? <span className="badge-new">{copy.scanner.welcome}</span> : null}
                {banner.endsAt ? <span className="banner-ends">{copy.scanner.endsAt(day.format(new Date(banner.endsAt)))}</span> : null}
              </div>
              {banner.featured ? <FeaturedCard banner={banner} /> : null}
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
                  <PullButton count={1} cost={copy.scanner.costSignals(view.costs.signals)} disabled={busy || signals < view.costs.signals} onClick={() => scan(1, 'signal')} solar={!isEvent} event={isEvent} />
                  <PullButton count={10} cost={copy.scanner.costSignals(view.costs.signals * 10)} disabled={busy || signals < view.costs.signals * 10} onClick={() => scan(10, 'signal')} solar={!isEvent} event={isEvent} tour="pull10" />
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
