import "server-only";
import { connection } from "next/server";
import { CircleAlert, Hourglass } from "lucide-react";
import { PublicConnectLazy } from "@/components/public/public-connect-lazy";
import { getPublicSession } from "@/lib/auth/public-session";
import { firstParam } from "@/lib/checker/input";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { localizedPath } from "@/lib/i18n/routes";
import { getPublicProfileView } from "@/lib/pay/queries";
import { safeError } from "@/lib/security/redact";
import { parseVouchLookup } from "@/lib/vouches/lookup";
import { getVouchAvailability, getVouchesFor, getVouchesGivenBy } from "@/lib/vouches/queries";
import type { GivenVouch, VouchesSummary } from "@/lib/vouches/types";
import { GivenVouches } from "./given-vouches";
import { VouchForm } from "./vouch-form";
import { VouchLookup, type VouchLookupError } from "./vouch-lookup";
import { VouchSummary } from "./vouch-summary";

type SearchParams = Record<string, string | string[] | undefined>;

const SECTION = "flex min-w-0 flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6";
const H2 = "font-display text-xl font-bold text-fg";

function Alert({ text, icon = "alert" }: { text: string; icon?: "alert" | "wait" }) {
  const Icon = icon === "wait" ? Hourglass : CircleAlert;
  return (
    <p role={icon === "wait" ? "status" : "alert"} className="flex items-start gap-2 text-sm text-fg">
      <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${icon === "wait" ? "text-warning" : "text-danger"}`} />
      {text}
    </p>
  );
}

/**
 * The tool below its header (inside the page's <Suspense>): the lookup and, with a valid `?address=` (address or Pay
 * alias), the received vouches; then, with a session, the form and «Tus avales» when our schema is registered on this
 * Base (Review Focus 1), or the connect button without one. Every read happens after `await connection()`.
 */
export async function VouchesContent({ lang, searchParams }: { lang: Lang; searchParams: Promise<SearchParams> }) {
  const t = getDictionary(lang).vouches;
  const raw = firstParam((await searchParams).address).trim();
  const lookup = parseVouchLookup(raw);
  const action = localizedPath(lang, "vouches");
  await connection();

  let lookupError: VouchLookupError | null = lookup.kind === "invalid" ? "invalid" : null;
  let target: { address: string; alias: string | null } | null = null;
  let summary: VouchesSummary | null = null;
  let readFailed = false;
  try {
    if (lookup.kind === "address") target = { address: lookup.address, alias: null };
    if (lookup.kind === "alias") {
      const profile = await getPublicProfileView(lookup.alias);
      if (profile) target = { address: profile.address, alias: profile.alias };
      else lookupError = "notFound";
    }
    if (target) summary = await getVouchesFor(target.address);
  } catch (e) {
    console.error("[vouches] lookup failed", safeError(e instanceof Error ? e.message : String(e)));
    readFailed = true;
  }

  const session = await getPublicSession();
  // Looking yourself up does not prefill the form with your own address (it would open on the «self» error).
  const prefill = target && session && target.address.toLowerCase() !== session.wallet.toLowerCase() ? target.address : "";
  const sessionPart = session ? await renderSessionPart(lang, session.wallet, prefill) : null;
  const next = raw ? `${action}?address=${encodeURIComponent(raw)}` : action;

  return (
    <div className="flex flex-col gap-6">
      <VouchLookup key={`${raw}|${lookupError ?? ""}`} t={t.lookup} action={action} defaultValue={raw} error={lookupError} />

      {target || readFailed ? (
        <section aria-labelledby="vouches-received" className={SECTION}>
          <div className="flex flex-col gap-1">
            <h2 id="vouches-received" className={H2}>
              {t.summary.title}
            </h2>
            {target ? (
              <p className="font-mono text-sm break-all text-fg-muted">
                {target.alias ? `@${target.alias} · ` : ""}
                {target.address}
              </p>
            ) : null}
          </div>
          {summary ? <VouchSummary lang={lang} t={t} summary={summary} refresh /> : <Alert text={t.summary.loadFailed} />}
        </section>
      ) : null}

      {session ? (
        sessionPart
      ) : (
        <section aria-labelledby="vouches-connect" className={SECTION}>
          <h2 id="vouches-connect" className={H2}>
            {t.form.title}
          </h2>
          <p className="text-base text-fg-muted">{t.connectLead}</p>
          <div>
            <PublicConnectLazy lang={lang} next={next} variant="outline" />
          </div>
        </section>
      )}
    </div>
  );
}

/** The signed-in part, awaited by the caller (a plain async function, not a component: one render pass). */
async function renderSessionPart(lang: Lang, wallet: `0x${string}`, defaultRecipient: string) {
  const t = getDictionary(lang).vouches;
  const { chainId, registered } = await getVouchAvailability();
  if (registered !== true) {
    return (
      <section aria-labelledby="vouches-form" className={SECTION}>
        <h2 id="vouches-form" className={H2}>
          {t.form.title}
        </h2>
        <Alert text={registered === false ? t.unavailable : t.networkUnknown} icon="wait" />
      </section>
    );
  }

  let given: GivenVouch[] = [];
  let givenFailed = false;
  try {
    given = await getVouchesGivenBy(wallet);
  } catch (e) {
    console.error("[vouches] given read failed", safeError(e instanceof Error ? e.message : String(e)));
    givenFailed = true;
  }

  return (
    <>
      <section aria-labelledby="vouches-form" className={SECTION}>
        <h2 id="vouches-form" className={H2}>
          {t.form.title}
        </h2>
        <VouchForm key={defaultRecipient} t={t} chainId={chainId} sessionWallet={wallet} defaultRecipient={defaultRecipient} given={given} />
      </section>
      <section aria-labelledby="vouches-given" className={SECTION}>
        <h2 id="vouches-given" className={H2}>
          {t.given.title}
        </h2>
        {givenFailed ? <Alert text={t.summary.loadFailed} /> : <GivenVouches lang={lang} t={t} given={given} chainId={chainId} />}
      </section>
    </>
  );
}
