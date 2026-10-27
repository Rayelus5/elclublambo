import "server-only";
import { headers } from "next/headers";
import { connection } from "next/server";
import { CircleAlert, Hourglass } from "lucide-react";
import { CheckerForm, type CheckerFormError } from "@/components/checker/checker-form";
import { LinkReport } from "@/components/checker/link-report";
import { TokenReport } from "@/components/checker/token-report";
import { CopyButton } from "@/components/pay/copy-button";
import { classifyInput, firstParam } from "@/lib/checker/input";
import { getKnownDomains } from "@/lib/checker/link/allowed";
import { analyzeLink } from "@/lib/checker/link/analyze";
import { getTokenReport } from "@/lib/checker/token/analyze";
import { appChainIds } from "@/lib/economy/networks";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { localizedPath } from "@/lib/i18n/routes";
import { hitIpRateLimit } from "@/lib/rate-limit/ip";
import { siteOrigin } from "@/lib/start/site";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The checker's form and, with `?q=`, its report. Runs inside the page's <Suspense>: every service-role, RPC or external
 * read happens after `await connection()` (never at build). Invalid input is answered next to the field without spending
 * the visitor's quota; then one hit of `checker_web` (the page fails open when the limiter itself errors).
 */
export async function CheckerContent({ lang, searchParams }: { lang: Lang; searchParams: Promise<SearchParams> }) {
  const t = getDictionary(lang).checker;
  const sp = await searchParams;
  const q = firstParam(sp.q);
  const chainParam = firstParam(sp.chain);
  const chains = appChainIds();
  const action = localizedPath(lang, "checker");
  const input = classifyInput(q, chainParam, chains);

  const form = (error: CheckerFormError | null) => (
    <CheckerForm
      key={`${q}|${chainParam}|${error ?? ""}`}
      t={t.form}
      action={action}
      chains={chains}
      defaultQuery={q.trim()}
      defaultChain={input.kind === "token" ? input.chain : chains[0]!}
      error={error}
    />
  );
  const disclaimer = (
    <p className="flex items-start gap-2 text-sm text-fg-muted">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      {t.disclaimer}
    </p>
  );

  if (input.kind === "empty") return <div className="flex flex-col gap-6">{form(null)}</div>;
  if (input.kind === "error") return <div className="flex flex-col gap-6">{form(input.error)}</div>;
  // Whether text parses as a link does not depend on the known list: a malformed one is answered for free.
  if (input.kind === "link" && !analyzeLink(input.text, []).ok) return <div className="flex flex-col gap-6">{form("invalid_url")}</div>;

  await connection();
  const limit = await hitIpRateLimit("checker_web", await headers());
  if (limit === "rate_limited") {
    return (
      <div className="flex flex-col gap-6">
        {form(null)}
        <p role="alert" className="flex items-start gap-3 rounded-control border border-warning/70 p-3 text-sm font-bold text-fg">
          <Hourglass aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
          {t.rateLimited}
        </p>
      </div>
    );
  }

  const query = new URLSearchParams({ q: q.trim() });
  if (input.kind === "token") query.set("chain", String(input.chain));
  const shareUrl = new URL(`${action}?${query.toString()}`, siteOrigin()).toString();
  const actions = (
    <div className="flex flex-col gap-3">
      <CopyButton text={shareUrl} label={t.report.copyLink} doneText={t.report.copied} failedText={t.report.copyFailed} />
      {disclaimer}
    </div>
  );

  if (input.kind === "token") {
    const report = await getTokenReport(input.chain, input.address);
    return (
      <div className="flex flex-col gap-6">
        {form(null)}
        <TokenReport t={t} lang={lang} report={report} actions={actions} />
      </div>
    );
  }

  const report = analyzeLink(input.text, await getKnownDomains());
  if (!report.ok) return <div className="flex flex-col gap-6">{form("invalid_url")}</div>; // unreachable: parsed above
  return (
    <div className="flex flex-col gap-6">
      {form(null)}
      <LinkReport t={t} report={report} actions={actions} />
    </div>
  );
}
