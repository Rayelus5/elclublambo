import type { ReactNode } from "react";
import { Download } from "lucide-react";
import { GiveawayVerifier } from "@/components/giveaways/giveaway-verifier";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { fill } from "@/lib/i18n/fill";
import { localizedPath } from "@/lib/i18n/routes";
import type { PublicGiveawayView } from "@/lib/public-giveaways/types";
import { EntriesList } from "./entries-list";
import { GiveawayHeader } from "./giveaway-header";
import { HostPanel } from "./host-panel";
import { JoinPanel } from "./join-panel";
import { PrizePanel } from "./prize-panel";

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="text-h2">
          {title}
        </h2>
        {intro ? <p className="text-[13px] text-fg-muted">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Datum({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[13px] font-bold text-fg-muted">{label}</dt>
      <dd className="font-mono text-[13px] break-all">{value}</dd>
    </div>
  );
}

/**
 * The public giveaway page's body, already read on the server: header, entering, the organizer's panel, prizes,
 * verification and entries. Order on a phone: what a visitor came for (enter) first, the proof after.
 */
export function GiveawayDetail({
  lang,
  view: g,
  signedIn,
  viewerWallet,
  autoFocusJoin,
}: {
  lang: Lang;
  view: PublicGiveawayView;
  signedIn: boolean;
  viewerWallet: string | null;
  autoFocusJoin: boolean;
}) {
  const dict = getDictionary(lang);
  const t = dict.giveaways.detail;
  const errors = dict.giveaways.errors;
  const path = localizedPath(lang, "giveaway", { id: g.id });
  const round = String(g.targetRound);
  const revealed = g.status === "drawn" || g.status === "void";

  return (
    <div className="flex w-full flex-col gap-6">
      <GiveawayHeader lang={lang} view={g} t={t} free={dict.giveaways.create.free} />

      {g.status === "open" ? (
        <JoinPanel
          lang={lang}
          id={g.id}
          closesAt={g.closesAt}
          signedIn={signedIn}
          entered={g.iEntered}
          minTxCount={g.minTxCount}
          hasAllowlist={g.hasAllowlist}
          next={`${path}?join=1`}
          autoFocusJoin={autoFocusJoin}
          t={t.join}
          errors={errors}
        />
      ) : null}

      {g.isHost ? (
        <HostPanel
          lang={lang}
          id={g.id}
          status={g.status}
          closesAt={g.closesAt}
          hostAddress={g.hostAddress}
          prizes={g.prizes}
          t={t.host}
          errors={errors}
          noCustody={dict.common.noCustody}
        />
      ) : null}

      <Section id="prizes" title={t.prizes.title} intro={t.prizes.intro}>
        <PrizePanel lang={lang} prizes={g.prizes} viewerWallet={viewerWallet} t={t.prizes} />
      </Section>

      <Section id="verify" title={t.verify.title}>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
          <li>{t.verify.step1}</li>
          <li>{fill(t.verify.step2, { round })}</li>
          <li>{t.verify.step3}</li>
        </ol>
        <dl className="grid gap-3">
          <Datum label={t.verify.commit} value={g.seedCommit} />
          <Datum label={t.verify.round} value={round} />
          <Datum label={t.verify.seed} value={g.seedReveal ?? t.verify.seedHidden} />
          {revealed && g.drandSignature ? <Datum label={t.verify.signature} value={g.drandSignature} /> : null}
          {revealed && g.drandRandomness ? <Datum label={t.verify.randomness} value={g.drandRandomness} /> : null}
        </dl>
        {g.status === "drawn" && g.seedReveal ? (
          <GiveawayVerifier
            commit={g.seedCommit}
            seedReveal={g.seedReveal}
            targetRound={round}
            closesAt={g.closesAt}
            drandRandomness={g.drandRandomness}
            entryCount={g.entryCount}
            winnerPositions={[...g.prizes].sort((a, b) => a.rank - b.rank).map((p) => p.winnerPosition)}
            labels={t.verifier}
          />
        ) : null}
        {revealed ? (
          <a
            href={`${path}/entries`}
            download={`giveaway-${g.id}-entries.json`}
            className="inline-flex min-h-11 items-center gap-2 self-start rounded-control text-sm font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Download aria-hidden className="size-4" />
            {t.verify.download}
          </a>
        ) : null}
      </Section>

      <Section id="entries" title={t.entries.title} intro={g.status === "open" ? t.entries.introOpen : undefined}>
        <EntriesList entries={g.entries} viewerWallet={viewerWallet} t={t.entries} />
      </Section>

      <p role="note" className="border-t border-border pt-4 text-[13px] text-fg-muted">
        {dict.common.noCustody}
      </p>
    </div>
  );
}
