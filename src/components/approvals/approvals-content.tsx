import "server-only";
import { headers } from "next/headers";
import { connection } from "next/server";
import { Hourglass } from "lucide-react";
import { scanApprovals } from "@/lib/approvals/read";
import { getPublicSession } from "@/lib/auth/public-session";
import { ADDRESS_RE, firstParam } from "@/lib/checker/input";
import { appChainIds, chainForKey, isNetworkKey, type NetworkKey } from "@/lib/economy/networks";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { localizedPath } from "@/lib/i18n/routes";
import { hitIpRateLimit } from "@/lib/rate-limit/ip";
import { ApprovalsLazy } from "./approvals-lazy";
import { ApprovalsLookup } from "./approvals-lookup";
import { RevokeNotices } from "./revoke-notices";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The approvals tool below its header (inside the page's <Suspense>): the lookup and, with a valid `?address=` on a
 * valid `?chain=` (Base by default), the list. An invalid address is answered next to the field without spending quota;
 * then, after `await connection()` (never at build), one hit of `approvals_scan` (a limiter "error" fails open, as the
 * checker page), the scan, and the session's wallet (only the owner signs; Review Focus 2).
 */
export async function ApprovalsContent({ lang, searchParams }: { lang: Lang; searchParams: Promise<SearchParams> }) {
  const t = getDictionary(lang).approvals;
  const sp = await searchParams;
  const raw = firstParam(sp.address).trim();
  const chainParam = firstParam(sp.chain);
  const network: NetworkKey = isNetworkKey(chainParam) ? chainParam : "base";
  const valid = ADDRESS_RE.test(raw);
  const action = localizedPath(lang, "approvals");

  const lookup = (primary: boolean) => (
    <ApprovalsLookup
      key={`${raw}|${network}`}
      t={t.lookup}
      action={action}
      chains={appChainIds()}
      defaultValue={raw}
      defaultChain={network}
      error={raw !== "" && !valid ? "invalid" : null}
      primary={primary}
    />
  );
  if (!valid) return <div className="flex flex-col gap-6">{lookup(true)}</div>;

  const owner = raw as `0x${string}`;
  const chainId = chainForKey(network);
  // Above the list and in both branches: a refresh after a revoke answered rate_limited keeps the confirmations.
  const notices = <RevokeNotices lang={lang} chainId={chainId} owner={owner} />;
  await connection();
  if ((await hitIpRateLimit("approvals_scan", await headers())) === "rate_limited") {
    return (
      <div className="flex flex-col gap-6">
        {lookup(true)}
        {notices}
        <p role="alert" className="flex items-start gap-3 rounded-control border border-warning/70 p-3 text-sm font-bold text-fg">
          <Hourglass aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
          {t.rateLimited}
        </p>
      </div>
    );
  }

  const scan = await scanApprovals(chainId, owner);
  const session = await getPublicSession();
  return (
    <div className="flex flex-col gap-6">
      {lookup(false)}
      {notices}
      <ApprovalsLazy lang={lang} chainId={chainId} owner={owner} scan={scan} sessionWallet={session?.wallet ?? null} />
    </div>
  );
}
