import Link from "next/link";
import { getPublicSession } from "@/lib/auth/public-session";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { localizedPath } from "@/lib/i18n/routes";
import { getMyPublicGiveaways } from "@/lib/public-giveaways/queries";

const DATE_LOCALE: Record<Lang, string> = { es: "es-ES", en: "en-GB" };

/** «Mis sorteos»: only with a session; the visitor sees nothing here. */
export async function MyGiveaways({ lang }: { lang: Lang }) {
  if (!(await getPublicSession())) return null;
  const { giveaways } = getDictionary(lang);
  const t = giveaways.home;
  let cards: Awaited<ReturnType<typeof getMyPublicGiveaways>> | null = null;
  try {
    cards = await getMyPublicGiveaways(20);
  } catch {
    cards = null;
  }
  const date = new Intl.DateTimeFormat(DATE_LOCALE[lang], { dateStyle: "medium", timeStyle: "short" });
  return (
    <section aria-labelledby="my-giveaways" className="flex flex-col gap-3">
      <h2 id="my-giveaways" className="font-display text-xl font-bold text-fg">
        {t.mine}
      </h2>
      {cards === null ? (
        <p role="alert" className="text-base text-fg-muted">
          {t.error}
        </p>
      ) : cards.length === 0 ? (
        <p className="text-base text-fg-muted">{t.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {cards.map((c) => (
            <li key={c.id}>
              <Link
                href={localizedPath(lang, "giveaway", { id: c.id })}
                className="flex min-h-11 flex-col gap-1 rounded-control border border-border-strong bg-surface p-4 outline-none transition-colors hover:border-accent focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-fg">{c.title}</span>
                  <span className="rounded-control border border-border-strong px-2 py-1 text-small text-fg">
                    {giveaways.detail.status[c.status]}
                  </span>
                </span>
                <span className="text-small text-fg-muted">
                  {t.entries.replace("{n}", String(c.entryCount))} · {t.prizes.replace("{n}", String(c.prizeCount))} ·{" "}
                  {date.format(new Date(c.closesAt))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
