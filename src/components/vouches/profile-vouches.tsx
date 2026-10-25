import "server-only";
import { connection } from "next/server";
import { BadgeCheck, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { localizedPath } from "@/lib/i18n/routes";
import { safeError } from "@/lib/security/redact";
import { getVouchesFor } from "@/lib/vouches/queries";
import type { VouchesSummary } from "@/lib/vouches/types";
import { VouchNotice } from "./vouch-notice";
import { VouchSummary } from "./vouch-summary";

/**
 * «Avales» on /pay/<x>, below the payment (its own <Suspense>): distinct attesters per kind, the newest vouches with
 * easscan links and an outline link to vouch for this address. Links only: «Pagar» stays the screen's one brand fill. A
 * read error shows a message here and never reaches the payment widget.
 */
export async function ProfileVouches({ lang, address }: { lang: Lang; address: string }) {
  const dict = getDictionary(lang);
  const t = dict.vouches;
  await connection();

  let summary: VouchesSummary | null = null;
  try {
    summary = await getVouchesFor(address);
  } catch (e) {
    console.error("[vouches] profile read failed", safeError(e instanceof Error ? e.message : String(e)));
  }

  return (
    <section aria-labelledby="pay-vouches" className="flex min-w-0 flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6">
      <h2 id="pay-vouches" className="font-display text-xl font-bold text-fg">
        {dict.pay.page.vouchesTitle}
      </h2>
      {summary ? (
        <VouchSummary lang={lang} t={t} summary={summary} />
      ) : (
        <p role="alert" className="flex items-start gap-2 text-sm text-fg">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
          {t.summary.loadFailed}
        </p>
      )}
      <VouchNotice text={t.notice} />
      <Button asChild variant="outline" className="self-start">
        <a href={`${localizedPath(lang, "vouches")}?address=${address}`}>
          <BadgeCheck aria-hidden />
          {dict.pay.page.vouchesCta}
        </a>
      </Button>
    </section>
  );
}
