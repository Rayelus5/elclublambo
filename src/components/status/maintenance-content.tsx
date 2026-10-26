import { connection } from "next/server";
import { getSiteState } from "@/lib/admin/site-state";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { LocalTime } from "./local-time";
import { StatusShell } from "./status-shell";
import { TeamAccess } from "./team-access";

/**
 * The maintenance page body. Request time only (`connection()` first): the build never reads the state, and the response
 * stays dynamic, so the proxy's `Cache-Control: no-store` is never swapped for a prerender's `s-maxage`.
 */
export async function MaintenanceContent({ lang }: { lang: Lang }) {
  await connection();
  const t = getDictionary(lang).status;
  const { maintenance } = await getSiteState();
  const custom = maintenance.mode === "custom" ? (lang === "en" ? maintenance.messageEn : maintenance.messageEs) : null;
  const [before, after = ""] = t.returnAt.split("{time}");
  return (
    <StatusShell
      lang={lang}
      code="503"
      title={t.maintenanceTitle}
      text={
        <div className="flex flex-col gap-3">
          <p className="whitespace-pre-line break-words">{custom || t.maintenanceText}</p>
          {maintenance.returnAt ? (
            <p>
              {before}
              <LocalTime iso={maintenance.returnAt} lang={lang} />
              {after}
            </p>
          ) : null}
        </div>
      }
    >
      <TeamAccess lang={lang} />
    </StatusShell>
  );
}
