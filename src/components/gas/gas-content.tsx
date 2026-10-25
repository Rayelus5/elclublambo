import "server-only";
import { connection } from "next/server";
import { getGasSnapshot } from "@/lib/gas/read";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { DATE_LOCALE, fill } from "@/lib/i18n/fill";
import { GasTable } from "./gas-table";
import { UnitConverter } from "./unit-converter";

/** The time of the read, in UTC (the server does not know the visitor's zone). */
function readTime(lang: Lang, iso: string): string {
  const time = new Intl.DateTimeFormat(DATE_LOCALE[lang], { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(new Date(iso));
  return `${time} UTC`;
}

/** The streamed part of the gas page (inside its <Suspense>): every RPC read happens after `await connection()`. */
export async function GasContent({ lang }: { lang: Lang }) {
  await connection();
  const t = getDictionary(lang).gas;
  const snapshot = await getGasSnapshot();
  return (
    <div className="flex flex-col gap-6">
      <GasTable lang={lang} snapshot={snapshot} />
      <UnitConverter labels={t.converter} ethUsdE8={snapshot.ethUsdE8} />
      <p className="text-sm text-fg-muted">
        <time dateTime={snapshot.readAt}>{fill(t.readAt, { time: readTime(lang, snapshot.readAt) })}</time>
      </p>
    </div>
  );
}
