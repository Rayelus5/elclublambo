import { Suspense } from "react";
import { notFound } from "next/navigation";
import { BadgeCheck, CircleAlert, RotateCw, TriangleAlert } from "lucide-react";
import { CopyButton } from "@/components/pay/copy-button";
import { PayWidgetLazy } from "@/components/pay/pay-widget-lazy";
import { Button } from "@/components/ui/button";
import { ProfileVouches } from "@/components/vouches/profile-vouches";
import { getDictionary } from "@/lib/i18n";
import { isLang } from "@/lib/i18n/config";
import { fill } from "@/lib/i18n/fill";
import { localizedPath } from "@/lib/i18n/routes";
import { ALIAS_RE } from "@/lib/pay/alias";
import { parsePayQuery } from "@/lib/pay/link";
import { getPublicProfileView } from "@/lib/pay/queries";
import { ADDRESS_RE, payTitleName } from "@/lib/pay/target";
import type { PublicProfileView } from "@/lib/pay/types";
import { safeError } from "@/lib/security/redact";

type Props = {
  params: Promise<{ lang: string; target: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * The recipient and the payment form of /pay/<alias or address>. An unknown alias is a 404 from the proxy; this
 * notFound() is the safety net for when the proxy failed open on a read error. An address always resolves (P3-R4); a
 * read error shows a retry state and no payment form. The received vouches follow the payment (P5-R7).
 */
export async function PayPageContent({ params, searchParams }: Props) {
  const { lang, target } = await params;
  if (!isLang(lang)) notFound();
  const isAddress = ADDRESS_RE.test(target);
  if (!isAddress && !ALIAS_RE.test(target)) notFound();
  const t = getDictionary(lang).pay.page;

  let view: PublicProfileView | null;
  try {
    view = await getPublicProfileView(target);
  } catch (e) {
    // D22: on a read error the page cannot know which networks this target accepts (an address may have a profile
    // limited to one network), so it offers no payment at all, alias or address alike.
    console.error("[pay] profile read failed", safeError(e instanceof Error ? e.message : String(e)));
    return (
      <section aria-labelledby="pay-title" className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6">
        <h1 id="pay-title" className="break-words font-display text-2xl font-bold text-fg sm:text-3xl">
          {fill(t.titleTo, { name: payTitleName(target) ?? target })}
        </h1>
        <p role="alert" className="flex items-start gap-2 text-sm text-danger">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t.loadFailed}
        </p>
        <Button asChild variant="outline" className="self-start">
          <a href={localizedPath(lang, "pay", { target })}>
            <RotateCw aria-hidden />
            {t.retry}
          </a>
        </Button>
      </section>
    );
  }
  if (!view) notFound();

  const { amount, asset } = parsePayQuery(await searchParams, view.acceptNetworks);
  const heading = view.alias ? fill(t.titleTo, { name: `@${view.alias}` }) : t.titleAddress;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="pay-title" className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6">
        <div className="flex flex-col gap-2">
          <h1 id="pay-title" className="break-words font-display text-2xl font-bold text-fg sm:text-3xl">
            {heading}
          </h1>
          {view.displayName ? <p className="break-words text-base text-fg">{view.displayName}</p> : null}
          {view.isMember ? (
            <p className="inline-flex items-center gap-1.5 self-start rounded-control border border-accent/60 px-2 py-1 text-[13px] font-bold text-accent">
              <BadgeCheck aria-hidden className="size-4" />
              {t.memberBadge}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-bold text-fg">{t.addressLabel}</p>
          <p className="break-all rounded-control bg-surface-2 p-3 font-mono text-sm text-fg">{view.address}</p>
          <CopyButton text={view.address} label={t.copyAddress} doneText={t.copied} failedText={t.copyFailed} />
        </div>

        {view.alias ? null : (
          <div className="flex items-start gap-3 rounded-control border border-warning/70 p-3">
            <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-bold text-warning">{t.noProfileTitle}</p>
              <p className="text-sm text-fg">{t.noProfileText}</p>
            </div>
          </div>
        )}
      </section>

      <section aria-label={t.pay} className="rounded-panel border border-accent/60 bg-surface p-4 sm:p-6">
        <PayWidgetLazy
          lang={lang}
          t={t}
          to={view.address as `0x${string}`}
          accept={view.acceptNetworks}
          initialAmount={amount}
          initialAsset={asset}
        />
      </section>

      {/* P5-R7: after the payment and in its own boundary, so a slow or failed vouches read never holds up «Pagar». */}
      <Suspense fallback={<div className="min-h-40" aria-hidden />}>
        <ProfileVouches lang={lang} address={view.address} />
      </Suspense>
    </div>
  );
}
