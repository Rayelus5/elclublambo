"use client";

import { m } from "motion/react";
import { ShieldAlert, ShieldCheck, TriangleAlert, type LucideIcon } from "lucide-react";
import { rise, slide, Stage } from "@/components/start/motion";
import type { Dictionary } from "@/lib/i18n";
import { SoonBadge, SoonButton } from "./final-cta";

const CONTRACT = "0x7a3f0b9e2c41d85f6a1e3b07c9d2e4f8a6b1c91e";

/** The checker, not live yet (P2-R10): a pasted contract and the warnings that come up. The mock is decorative. */
export function CheckerDemo({ t, soon }: { t: Dictionary["landing"]; soon: string }) {
  // Icon and text carry the meaning; colour only reinforces it.
  const alerts: [LucideIcon, string, string][] = [
    [ShieldAlert, "text-danger", t.checker.mint],
    [TriangleAlert, "text-warning", t.checker.tax],
    [ShieldCheck, "text-success", t.checker.liquidity],
  ];
  return (
    <section aria-labelledby="landing-checker" className="flex min-w-0 flex-col gap-8 border-t border-border px-4 py-20 sm:px-8 sm:py-28 lg:border-t-0">
      <Stage className="flex flex-col gap-4">
        <m.div variants={rise} className="flex flex-wrap items-center gap-4">
          <h2 id="landing-checker" className="text-[clamp(2rem,4.5vw,3.75rem)] leading-[0.95] font-black tracking-[-0.04em] text-fg">
            {t.checker.title}
          </h2>
          <SoonBadge label={soon} />
        </m.div>
        <m.p variants={rise} className="max-w-[32rem] text-[1.0625rem] text-fg-muted">
          {t.checker.lead}
        </m.p>
      </Stage>

      <div aria-hidden className="overflow-hidden">
        <Stage className="flex max-w-[30rem] flex-col gap-3" gap={0.16}>
          <m.div variants={rise} className="flex flex-col gap-1.5">
            <span className="font-mono text-[0.75rem] text-fg-muted uppercase">{t.checker.field}</span>
            <span className="flex min-h-11 items-center border border-border-strong bg-surface px-3 font-mono text-[0.8125rem] text-fg rounded-control">
              <span className="min-w-0 truncate">{CONTRACT}</span>
              <span className="ml-0.5 inline-block h-4 w-px shrink-0 bg-accent" />
            </span>
          </m.div>
          {alerts.map(([Icon, tone, text]) => (
            <m.p key={text} variants={slide} className="flex items-center gap-3 border border-border bg-bg p-3 text-[0.9375rem] text-fg rounded-panel">
              <Icon className={`size-5 shrink-0 ${tone}`} strokeWidth={2} />
              {text}
            </m.p>
          ))}
        </Stage>
      </div>

      <div className="mt-auto">
        <SoonButton label={t.checker.check} soon={soon} />
      </div>
    </section>
  );
}
