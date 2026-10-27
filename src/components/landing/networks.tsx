"use client";

import { m } from "motion/react";
import { rise, Stage } from "@/components/start/motion";
import type { Dictionary } from "@/lib/i18n";

const NETS = [
  { name: "Base", logo: "/brand/networks/base.svg", lead: true },
  { name: "Arbitrum", logo: "/brand/networks/arbitrum.svg", lead: false },
] as const;

/** Where it runs: Base first, Arbitrum too. */
export function Networks({ t }: { t: Dictionary["landing"]["networks"] }) {
  return (
    <section aria-labelledby="landing-networks" className="border-t border-border">
      <div className="mx-auto grid w-full max-w-[1600px] items-end gap-12 px-4 py-24 sm:px-8 sm:py-32 lg:grid-cols-12">
        <Stage className="flex flex-col gap-6 lg:col-span-6">
          <m.h2
            variants={rise}
            id="landing-networks"
            className="text-[clamp(2.25rem,5vw,4.5rem)] leading-[0.95] font-black tracking-[-0.045em] text-fg"
          >
            {t.title}
          </m.h2>
          <m.p variants={rise} className="max-w-[32rem] text-[1.0625rem] text-fg-muted">
            {t.lead}
          </m.p>
        </Stage>
        <Stage as="ul" label={t.label} className="grid grid-cols-2 gap-3 lg:col-span-6" gap={0.12}>
          {NETS.map((net) => (
            <m.li
              key={net.name}
              variants={rise}
              className={`flex flex-col justify-between gap-10 border p-5 rounded-panel sm:p-6 ${net.lead ? "border-accent bg-surface" : "border-border bg-bg"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVG from /public */}
              <img src={net.logo} alt="" width={net.lead ? 56 : 44} height={net.lead ? 56 : 44} className="rounded-full" />
              <span
                className={`font-display leading-none font-black tracking-[-0.03em] text-fg semiwide ${
                  net.lead ? "text-[clamp(1.75rem,4vw,3rem)]" : "text-[clamp(1.375rem,3vw,2.25rem)]"
                }`}
              >
                {net.name}
              </span>
            </m.li>
          ))}
        </Stage>
      </div>
    </section>
  );
}
