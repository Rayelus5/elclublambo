import {
  TIERS,
  type BannerView,
  type PulledGalaxy,
  type PullRequest,
} from "@galaxy/shared";
import { useEffect, useId, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useGacha, usePull } from "../api/economy";
import { errorText } from "../auth/useMe";
import { copy, fmt } from "../copy/es";
import { WalletBar } from "../hub/WalletBar";
import { Icon } from "../ui/Icon";
import { againPlan } from "./again";
import { preloadProCinema } from "./pro/ProShell";
import { RevealStage } from "./RevealStage";
import { useRevealMode } from "./useRevealMode";
import { BackLink } from "../ui/BackLink";
import { emitTour } from "../tour/bus";
import { tourActive, useTutorial } from "../api/tutorial";

// The deep scan (GDD §9): everything the player needs to decide is visible BEFORE paying — the odds of each tier on
// the next scan (rising luck included), how far the guaranteed Legendary is, the welcome luck — then scan with the
// daily free scan, signals or coins. The server rolls; this screen only asks and plays the reveal.
const day = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Madrid",
});
const traitNames = copy.traitNames;
const traitValues = copy.traitValues as Record<string, Record<string, string>>;

function Odds({ banner }: { banner: BannerView }) {
  const total = banner.sinceLegendary + banner.untilGuarantee;
  return (
    <div className="odds" data-tour="odds">
      <table aria-label={copy.scanner.odds}>
        <caption>{copy.scanner.odds}</caption>
        <tbody>
          {/* The mythic has its own chance (0 until the owner publishes it): its row shows only once it can come out. */}
          {[...TIERS]
            .reverse()
            .filter((t) => t !== 'mythic' || (banner.nextRates[TIERS.indexOf(t)] ?? 0) > 0)
            .map((t) => (
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
          <i
            style={{
              width: `${total > 0 ? Math.round((banner.sinceLegendary / total) * 100) : 0}%`,
            }}
          />
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
  const sentence =
    until !== undefined ? copy.scanner.untilFeatured(until) : null;
  const num = until !== undefined ? fmt(until) : "";
  const parts = sentence && sentence.includes(num) ? sentence.split(num) : null;
  return (
    <section className="scan-featured" aria-labelledby={id}>
      <span className="scan-featured-shine" aria-hidden="true" />
      <div className="scan-featured-main">
        <p className="scan-featured-kicker">
          <Icon name="starOn" />
          <span id={id}>{copy.scanner.featuredTitle}</span>
        </p>
        <p className="scan-featured-value">
          {traitValues[f.trait]?.[f.value] ?? f.value}
        </p>
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
            <div
              className="scan-featured-bar"
              role="progressbar"
              aria-label={copy.scanner.featuredProgress}
              aria-valuemin={0}
              aria-valuemax={every}
              aria-valuenow={Math.max(0, every - until)}
            >
              <i
                style={{
                  width: `${Math.round((Math.max(0, every - until) / every) * 100)}%`,
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function PullButton({
  count,
  cost,
  disabled,
  onClick,
  solar,
  event,
  tour,
}: {
  count: 1 | 10;
  cost: string;
  disabled: boolean;
  onClick: () => void;
  solar?: boolean;
  event?: boolean;
  tour?: string;
}) {
  return (
    <button
      type="button"
      className={`lip pull-btn${solar ? " solar" : ""}${event ? " pull-event" : ""}`}
      disabled={disabled}
      onClick={onClick}
      data-tour={tour}
    >
      <b>{copy.scanner.pull(count)}</b>
      <span>{cost}</span>
    </button>
  );
}

export function ScannerScreen() {
  const gacha = useGacha();
  const pull = usePull();
  const [bannerId, setBannerId] = useState<string | null>(null);
  // The scan on screen and how it was paid: the summary offers the same one again (Nov plan A1).
  // The scanner it was too: «¡Escanear otra!» never scans in another one (Nov plan A review).
  // The pro reveal opens while the request is out (`pulls` null) and keeps the last summary to come back to if it
  // fails (`last`); `failed` opens its bands again (plan «escáner pro», part B).
  const [revealed, setRevealed] = useState<{
    pulls: PulledGalaxy[] | null;
    last: PulledGalaxy[] | null;
    count: 1 | 10;
    pay: PullRequest["pay"];
    banner: string;
    failed?: boolean;
    summaryOnly?: boolean;
  } | null>(null);
  const mode = useRevealMode();
  // The tutorial's first scan (the owner): its summary leaves only «Cerrar», which moves the tutorial on; «Colección» or
  // another scan took the player off the step it waits on.
  const tutorial = useTutorial().data;
  const guided = tourActive(tutorial) && tutorial?.chapter === "scanner";
  // The cinema's chunk (GSAP, three.js) is fetched while the player reads the odds.
  useEffect(() => {
    if (mode !== "pro") return;
    const timer = setTimeout(preloadProCinema, 1200);
    return () => clearTimeout(timer);
  }, [mode]);
  // `?tipo=evento` (from the event's missions tab) opens on the event scanner.
  const [params] = useSearchParams();
  const view = gacha.data;
  const wanted =
    params.get("tipo") === "evento"
      ? view?.banners.find((b) => b.kind === "event")
      : undefined;
  const banner =
    view?.banners.find((b) => b.id === bannerId) ?? wanted ?? view?.banners[0];
  const isEvent = banner?.kind === "event";
  const wallet = view?.wallet;

  function scan(
    count: 1 | 10,
    pay: PullRequest["pay"],
    on: string | undefined = banner?.id,
  ): void {
    if (!on) return;
    const pro = mode === "pro";
    if (pro)
      setRevealed((r) => ({
        pulls: null,
        last: r?.pulls ?? r?.last ?? null,
        count,
        pay,
        banner: on,
      }));
    pull.mutate(
      { banner: on, count, pay },
      {
        onSuccess: (res) => {
          setRevealed({ pulls: res.pulls, last: null, count, pay, banner: on });
          emitTour("scanner:pulled");
        },
        onError: () => {
          if (pro) setRevealed((r) => (r ? { ...r, failed: true } : r));
        },
      },
    );
  }

  const busy = pull.isPending;
  // The standard signals, or an event scanner's own (M7e-1).
  const signals = banner ? (wallet?.[banner.currency] ?? 0) : 0;
  const againOn = revealed
    ? view?.banners.find((b) => b.id === revealed.banner)
    : undefined;
  const again =
    revealed && view && againOn
      ? againPlan(
          revealed.count,
          revealed.pay,
          view.costs,
          wallet?.[againOn.currency] ?? 0,
          wallet?.coins ?? 0,
        )
      : null;
  return (
    <div className="screen-root collection-root scanner-root">
      <div className={`collection scanner${isEvent ? " is-event" : ""}`}>
        <header className="collection-bar">
          <BackLink fallback="/" />
          <h1>{isEvent ? copy.scanner.eventTab : copy.scanner.title}</h1>
          <div className="lip panel hud">
            <WalletBar wallet={wallet} />
          </div>
        </header>

        {view && view.banners.length > 1 ? (
          <div
            className="scanner-tabs"
            role="group"
            aria-label={copy.scanner.title}
          >
            {view.banners.map((b) => (
              <button
                key={b.id}
                type="button"
                className={`lip scanner-tab tab-${b.kind}`}
                aria-pressed={b.id === banner?.id}
                onClick={() => setBannerId(b.id)}
              >
                <Icon name={b.kind === "event" ? "starOn" : "radar"} />
                <span className="scanner-tab-name">
                  {b.kind === "event" ? copy.scanner.eventTab : b.name}
                </span>
                {b.kind === "event" ? (
                  <span className="scanner-tab-badge">
                    <Icon name="ticket" />
                    <b aria-hidden="true">{wallet?.[b.currency] ?? 0}</b>
                    <span className="sr-only">
                      {copy.hub.resource.eventSignal(wallet?.[b.currency] ?? 0)}
                    </span>
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}

        {banner && view ? (
          <main className="scanner-main">
            <section
              className="lip panel scanner-terminal"
              aria-labelledby="banner-name"
            >
              <div className="crt idle" aria-hidden="true">
                <div className="crt-screen">
                  <span className="idle-braille">⠎⠉⠁⠝</span>
                  <span className="idle-text">{copy.scanner.ready}</span>
                </div>
              </div>
              <div className="banner-head">
                <h2 id="banner-name">
                  {isEvent ? copy.scanner.eventTab : banner.name}
                </h2>
                {isEvent ? (
                  <span className="banner-sub">{banner.name}</span>
                ) : null}
                {banner.welcome ? (
                  <span className="badge-new">{copy.scanner.welcome}</span>
                ) : null}
                {banner.endsAt ? (
                  <span className="banner-ends">
                    {copy.scanner.endsAt(day.format(new Date(banner.endsAt)))}
                  </span>
                ) : null}
              </div>
              {banner.featured ? <FeaturedCard banner={banner} /> : null}
            </section>

            <aside className="lip panel scanner-side">
              <Odds banner={banner} />
              {pull.isError && !revealed ? (
                <p className="summary error" role="alert">
                  <Icon name="alert" />
                  <span>{errorText(pull.error, copy.errors)}</span>
                </p>
              ) : null}
              {view.freePullAvailable && banner.kind === "standard" ? (
                <button
                  type="button"
                  className="lip pull-free"
                  disabled={busy}
                  onClick={() => scan(1, "free")}
                >
                  <Icon name="radar" />
                  <span>
                    <b>{copy.scanner.free}</b>
                    <span>{copy.scanner.freeHint}</span>
                  </span>
                </button>
              ) : null}
              {banner.currency === "signal" ||
              banner.currency.startsWith("signal:") ? (
                <div className="pull-row">
                  <span className="pull-label">
                    {banner.currency === "signal"
                      ? copy.scanner.withSignals
                      : copy.scanner.withEventSignals(signals)}
                  </span>
                  <PullButton
                    count={1}
                    cost={copy.scanner.costSignals(view.costs.signals)}
                    disabled={busy || signals < view.costs.signals}
                    onClick={() => scan(1, "signal")}
                    solar={!isEvent}
                    event={isEvent}
                  />
                  <PullButton
                    count={10}
                    cost={copy.scanner.costSignals(view.costs.signals * 10)}
                    disabled={busy || signals < view.costs.signals * 10}
                    onClick={() => scan(10, "signal")}
                    solar={!isEvent}
                    event={isEvent}
                    tour="pull10"
                  />
                </div>
              ) : null}
              <div className="pull-row">
                <span className="pull-label">{copy.scanner.withCoins}</span>
                <PullButton
                  count={1}
                  cost={copy.scanner.costCoins(view.costs.coins)}
                  disabled={busy || (wallet?.coins ?? 0) < view.costs.coins}
                  onClick={() => scan(1, "coins")}
                />
                <PullButton
                  count={10}
                  cost={copy.scanner.costCoins(view.costs.coinsTen)}
                  disabled={busy || (wallet?.coins ?? 0) < view.costs.coinsTen}
                  onClick={() => scan(10, "coins")}
                />
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
          pulls={revealed.pulls}
          failed={revealed.failed}
          summaryOnly={revealed.summaryOnly}
          // The bands have opened again: back to the last summary (its error over the buttons), or to the scanner.
          onAbort={() =>
            setRevealed((r) =>
              r?.last
                ? {
                    ...r,
                    pulls: r.last,
                    last: null,
                    failed: false,
                    summaryOnly: true,
                  }
                : null,
            )
          }
          onClose={() => {
            setRevealed(null);
            emitTour("scanner:revealClosed");
          }}
          status={
            pull.isError ? (
              <p className="summary error" role="alert">
                <Icon name="alert" />
                <span>{errorText(pull.error, copy.errors)}</span>
              </p>
            ) : revealed && !againOn ? (
              <p className="summary-missing">{copy.scanner.againClosed}</p>
            ) : again && again.missing > 0 ? (
              <p className="summary-missing">
                {again.currency === "signal"
                  ? copy.scanner.missingSignals(again.missing)
                  : copy.scanner.missingCoins(again.missing)}
              </p>
            ) : null
          }
          actions={
            guided ? null : (
              <>
                {again ? (
                  <button
                    type="button"
                    className="lip pill pill-solar scan-again"
                    disabled={busy || again.missing > 0}
                    aria-busy={busy || undefined}
                    onClick={() =>
                      scan(again.count, again.pay, revealed?.banner)
                    }
                  >
                    <Icon name="radar" />
                    <span>
                      {busy
                        ? copy.scanner.scanning
                        : copy.scanner.again(again.count)}
                    </span>
                    {busy ? null : (
                      <small>
                        {again.currency === "signal"
                          ? copy.scanner.costSignals(again.cost)
                          : copy.scanner.costCoins(again.cost)}
                      </small>
                    )}
                  </button>
                ) : revealed ? (
                  // Its scanner has closed: the button stays, off, with the reason over it.
                  <button
                    type="button"
                    className="lip pill pill-solar scan-again"
                    disabled
                  >
                    <Icon name="radar" />
                    <span>{copy.scanner.again(revealed.count)}</span>
                  </button>
                ) : null}
                <Link to="/coleccion" className="lip pill pill-uv">
                  <Icon name="cards" />
                  <span>{copy.scanner.toCollection}</span>
                </Link>
              </>
            )
          }
        />
      ) : null}
    </div>
  );
}
