import { after } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { PublicDonatePanelLazy } from "@/components/public-donations/public-donate-panel-lazy";
import { getPublicSession } from "@/lib/auth/public-session";
import { getMyPublicDonations } from "@/lib/donations/public-queries";
import { donationChainsStatus } from "@/lib/economy/club-safe";
import type { ChainId } from "@/lib/economy/networks";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { localizedPath } from "@/lib/i18n/routes";
import { reverifyPublicIntentsFor } from "@/lib/payments/confirm";
import { shouldRecheckMember } from "@/lib/payments/recheck-throttle";
import { safeError } from "@/lib/security/redact";

/**
 * A failed read shows its own notice and leaves the rest of the page standing. Next's own control-flow rejections (the
 * build's prerender ending on a short-lived "use cache" read) are rethrown, never shown as a failed read.
 */
export function settle<T>(label: string, p: Promise<T>): Promise<T | null> {
  return p.catch((e: unknown) => {
    unstable_rethrow(e);
    console.error(`[donations] public ${label} read failed`, safeError(e));
    return null;
  });
}

/**
 * Session gate of the public donate page: sign-in, the member's link to the club page, or the donation flow on the
 * networks with a Safe. A signed-in non-member's sent-but-unrecorded donations (tab closed, session expired) are
 * re-verified off the response path, at most once per throttle window: that is what records them «on their own».
 */
export async function DonateGate({ lang }: { lang: Lang }) {
  const t = getDictionary(lang).donate;
  const session = await getPublicSession();
  const donor = session && !session.isMember;
  if (donor && shouldRecheckMember(`public:${session.userId}`)) {
    const userId = session.userId;
    after(() => reverifyPublicIntentsFor(userId));
  }
  const [status, mine] = donor
    ? await Promise.all([settle("donation chains", donationChainsStatus()), settle("my donations", getMyPublicDonations())])
    : [{ chains: [] as ChainId[], networkError: false }, null];
  // A failed check with no network available reads «could not load», never «not available yet».
  const chainsFailed = status === null || (status.chains.length === 0 && status.networkError);
  return (
    <PublicDonatePanelLazy
      lang={lang}
      t={t}
      session={session ? { wallet: session.wallet, isMember: session.isMember } : null}
      chains={status?.chains ?? []}
      chainsFailed={chainsFailed}
      myTotalUsd6={mine ? mine.totalUsd6.toString() : null}
      next={localizedPath(lang, "donate")}
    />
  );
}
