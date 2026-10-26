import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { localizedPath } from "@/lib/i18n/routes";
import type { ToolKey } from "@/lib/admin/state";
import { LangSwitch } from "./lang-switch";
import { SocialLinks } from "./social-links";
import { CARDS, offTools } from "./tool-grid";

const link =
  "inline-flex min-h-11 items-center text-small text-fg-muted underline-offset-4 outline-none hover:text-fg hover:underline focus-visible:ring-2 focus-visible:ring-accent rounded-control";
const heading = "font-mono text-[0.75rem] font-bold uppercase tracking-wider text-fg";

/** A link, or (switched off) muted text with the «not available» suffix: never an opacity fade, so contrast holds. */
function Entry({ href, off, unavailable, children }: { href: string; off: boolean; unavailable: string; children: ReactNode }) {
  return off ? (
    <span aria-disabled="true" className="inline-flex min-h-11 items-center text-small text-fg-muted">
      {children} ({unavailable})
    </span>
  ) : (
    <Link href={href} className={link}>
      {children}
    </Link>
  );
}

/** The footer's link columns; pure, so the switches (off) come in as a prop. */
export function FooterNav({ lang, off }: { lang: Lang; off: ReadonlySet<ToolKey> }) {
  const t = getDictionary(lang);
  const f = t.footer;
  const un = t.tools.unavailableNow;
  return (
    <>
      <div>
        <h2 className={heading}>{f.toolsHeading}</h2>
        <nav aria-label={f.toolsHeading} className="mt-2">
          <ul>
            {CARDS.map(({ key, copy, route }) => (
              <li key={key}>
                <Entry href={localizedPath(lang, route)} off={off.has(key)} unavailable={un}>
                  {t.tools[copy].name}
                </Entry>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div>
        <h2 className={heading}>{f.clubHeading}</h2>
        <nav aria-label={f.clubHeading} className="mt-2">
          <ul>
            <li>
              <Link href={localizedPath(lang, "start")} className={link}>
                {f.whatIs}
              </Link>
            </li>
            <li>
              <Link href="/foro" className={link}>
                {f.forum}
              </Link>
            </li>
            <li>
              <Entry href={localizedPath(lang, "donate")} off={off.has("donate")} unavailable={un}>
                {f.donate}
              </Entry>
            </li>
          </ul>
        </nav>
      </div>
    </>
  );
}

async function FooterNavLive({ lang }: { lang: Lang }) {
  return <FooterNav lang={lang} off={await offTools()} />;
}

export function PublicFooter({ lang }: { lang: Lang }) {
  const t = getDictionary(lang);
  return (
    <footer className="mt-auto border-t border-border bg-bg">
      <div className="mx-auto grid w-full max-w-[1600px] gap-8 px-4 py-10 sm:px-8 md:grid-cols-4">
        <div className="flex flex-col items-start gap-3">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo/elclub-logo-1.svg" alt="" width={32} height={32} className="size-8" />
            <span className="font-display text-lg leading-none font-black text-fg">ElClub.</span>
          </div>
          <p className="text-small text-fg-muted">{t.footer.tagline}</p>
          <p className="font-mono text-[0.75rem] text-fg-muted">{t.footer.builtOn}</p>
          <SocialLinks lang={lang} />
        </div>
        <Suspense fallback={<FooterNav lang={lang} off={new Set()} />}>
          <FooterNavLive lang={lang} />
        </Suspense>
        <div>
          <h2 id="footer-lang" className={heading}>
            {t.footer.language}
          </h2>
          <LangSwitch lang={lang} labelledBy="footer-lang" className="mt-2 -ml-3" />
        </div>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-2 px-4 py-6 text-small text-fg-muted sm:px-8 lg:flex-row lg:items-center lg:justify-between">
          <p className="max-w-[44rem]">
            {t.common.noCustody} {t.connect.notAdvice}
          </p>
          <p className="font-mono text-[0.75rem]">{t.footer.rights}</p>
        </div>
      </div>
    </footer>
  );
}
