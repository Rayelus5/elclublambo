"use client";

import { m, type Variants } from "motion/react";
import { Link2 } from "lucide-react";
import { AssetLogo } from "@/components/economy/asset-logo";
import { EASE_OUT, pop, rise, Stage } from "@/components/start/motion";
import type { Dictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { PayLink } from "./final-cta";

const PAY_LINK = "elclub.party/pay/7Kq2";
const PAY_TO = "0x9c1e…44fa";

/** The link drops a line down to its card. */
const growDown: Variants = {
  hide: { scaleY: 0, transition: { duration: 0 } },
  show: { scaleY: 1, transition: { duration: 0.5, ease: EASE_OUT } },
};

/** ElClub Pay (live since P3): a link that unfolds into a payment card. The mock is decorative. */
export function PayDemo({ lang, t, noCustody }: { lang: Lang; t: Dictionary["landing"]; noCustody: string }) {
  return (
    <section aria-labelledby="landing-pay" className="flex min-w-0 flex-col gap-8 px-4 py-20 sm:px-8 sm:py-28 lg:border-r lg:border-border">
      <Stage className="flex flex-col gap-4">
        <m.div variants={rise} className="flex flex-wrap items-center gap-4">
          <h2 id="landing-pay" className="text-[clamp(2rem,4.5vw,3.75rem)] leading-[0.95] font-black tracking-[-0.04em] text-fg">
            {t.pay.title}
          </h2>
        </m.div>
        <m.p variants={rise} className="max-w-[32rem] text-[1.0625rem] text-fg-muted">
          {t.pay.lead}
        </m.p>
      </Stage>

      <div aria-hidden>
        <Stage className="flex flex-col items-start" gap={0.18}>
          <m.p
            variants={rise}
            className="inline-flex max-w-full items-center gap-2 border border-border-strong bg-surface px-3 py-2 font-mono text-[0.8125rem] text-fg rounded-control"
          >
            <Link2 className="size-4 shrink-0 text-accent" strokeWidth={2} />
            <span className="text-fg-muted">{t.pay.link}</span>
            <span className="min-w-0 truncate">{PAY_LINK}</span>
          </m.p>
          <m.span variants={growDown} className="ml-6 block h-8 w-px origin-top bg-accent" />
          <m.div variants={pop} className="w-full max-w-[22rem] border border-accent bg-surface p-5 rounded-panel">
            <p className="font-mono text-[0.75rem] text-fg-muted uppercase">{t.pay.concept}</p>
            <p className="mt-3 flex items-center gap-3">
              <AssetLogo token="USDC" chainId={8453} size={32} />
              <span className="font-display text-[2rem] leading-none font-black tracking-[-0.03em] text-fg semiwide">25 USDC</span>
            </p>
            <p className="mt-4 font-mono text-[0.75rem] text-fg-muted">
              {t.pay.payTo} <span className="text-fg">{PAY_TO}</span> · Base
            </p>
            <span className="mt-5 flex min-h-11 items-center justify-center bg-accent font-bold text-accent-foreground rounded-control">
              {t.pay.pay}
            </span>
          </m.div>
        </Stage>
      </div>

      <div className="mt-auto flex flex-col items-start gap-4">
        <PayLink lang={lang} label={t.createPay} />
        <p className="text-small text-fg-muted">{noCustody}</p>
      </div>
    </section>
  );
}
