import { unstable_rethrow } from "next/navigation";
import { CircleAlert, RotateCw } from "lucide-react";
import { EmbedSnippet } from "@/components/pay/embed-snippet";
import { LinkBuilder } from "@/components/pay/link-builder";
import { ProfileForm } from "@/components/pay/profile-form";
import { PublicConnectLazy } from "@/components/public/public-connect-lazy";
import { Button } from "@/components/ui/button";
import { getPublicSession } from "@/lib/auth/public-session";
import { assetsFor } from "@/lib/economy/assets";
import { chainsForSet, networkSet } from "@/lib/economy/networks";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { localizedPath } from "@/lib/i18n/routes";
import { getMyPublicProfile } from "@/lib/pay/queries";
import type { MyPublicProfile } from "@/lib/pay/types";
import { safeError } from "@/lib/security/redact";
import { siteOrigin } from "@/lib/start/site";

const SECTION = "flex flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6";

/**
 * Session gate of the Pay tool: the three-line explainer and the connect button without a session; profile, link and
 * button with one. A failed profile read shows a retry state, never an empty form (it would default to every network
 * and could overwrite the saved ones on the next save, D22).
 */
export async function PayToolGate({ lang }: { lang: Lang }) {
  const t = getDictionary(lang).pay.tool;
  const session = await getPublicSession();
  if (!session) {
    return (
      <div className="flex flex-col gap-5">
        <ul className="flex list-disc flex-col gap-2 pl-5 text-base text-fg-muted">
          <li>{t.explain1}</li>
          <li>{t.explain2}</li>
          <li>{t.explain3}</li>
        </ul>
        <p className="text-sm text-fg-muted">{t.connectHint}</p>
        <div>
          <PublicConnectLazy lang={lang} next={localizedPath(lang, "payTool")} />
        </div>
        <p className="text-sm text-fg-muted">{t.noCustody}</p>
      </div>
    );
  }

  let profile: MyPublicProfile | null;
  try {
    profile = await getMyPublicProfile();
  } catch (e) {
    unstable_rethrow(e);
    console.error("[pay] tool profile read failed", safeError(e instanceof Error ? e.message : String(e)));
    return (
      <div className="flex flex-col gap-6">
        <section aria-labelledby="pay-profile" className={SECTION}>
          <h2 id="pay-profile" className="font-display text-xl font-bold text-fg">
            {t.profileTitle}
          </h2>
          <p role="alert" className="flex items-start gap-2 text-sm text-danger">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t.loadFailed}
          </p>
          <Button asChild variant="outline" className="self-start">
            <a href={localizedPath(lang, "payTool")}>
              <RotateCw aria-hidden />
              {t.retry}
            </a>
          </Button>
        </section>
        <p className="text-sm text-fg-muted">{t.noCustody}</p>
      </div>
    );
  }

  const origin = siteOrigin().origin;
  const assetIds = profile ? assetsFor(chainsForSet(networkSet()), profile.acceptNetworks).map((a) => a.id) : [];
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="pay-profile" className={SECTION}>
        <h2 id="pay-profile" className="font-display text-xl font-bold text-fg">
          {t.profileTitle}
        </h2>
        <ProfileForm lang={lang} t={t} initial={profile} isMember={session.isMember} />
      </section>
      {profile ? (
        <>
          <section aria-labelledby="pay-link-title" className={SECTION}>
            <h2 id="pay-link-title" className="font-display text-xl font-bold text-fg">
              {t.linkTitle}
            </h2>
            <p className="text-sm text-fg-muted">{t.linkLead}</p>
            <LinkBuilder lang={lang} t={t} alias={profile.alias} origin={origin} assetIds={assetIds} />
          </section>
          <section aria-labelledby="pay-embed-title" className={SECTION}>
            <h2 id="pay-embed-title" className="font-display text-xl font-bold text-fg">
              {t.embedTitle}
            </h2>
            <p className="text-sm text-fg-muted">{t.embedLead}</p>
            <EmbedSnippet lang={lang} t={t} alias={profile.alias} origin={origin} />
          </section>
        </>
      ) : null}
      <p className="text-sm text-fg-muted">{t.noCustody}</p>
    </div>
  );
}
