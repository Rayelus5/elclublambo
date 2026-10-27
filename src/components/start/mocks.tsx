"use client";

import { ArrowUpRight, Check, Hash, Lock, Search, ShieldAlert, ShieldCheck, Trophy } from "lucide-react";
import { m } from "motion/react";
import type { StartDict } from "./dict";
import { draw, grow, pop, rise, slide, Stage } from "./motion";

type Props = { t: StartDict["mocks"] };

/** Sample numbers are written in English format; the dictionary says which marks the language uses. */
const num = (t: Props["t"], v: string | undefined) => (v ?? "").replace(/[.,]/g, (c) => (c === "." ? t.decimal : t.group));

/*
 * Stylised product mock-ups, in code, with invented data. Decorative (the copy next to each one says what it shows), so
 * the frame that holds them is aria-hidden. Each one plays when it scrolls into view (see <Stage>).
 */

const mono = "font-mono text-[0.75rem] text-fg-muted";
const chip = "inline-flex items-center gap-1 border border-border-strong px-1.5 py-0.5 font-mono text-[0.6875rem] rounded-control";

export function HomeMock({ t }: Props) {
  return (
    <Stage className="flex flex-col gap-3 p-4 sm:p-5" gap={0.12}>
      <m.div variants={rise} className="flex items-center gap-3 border border-accent px-3 py-3 rounded-panel">
        <Search className="size-4 shrink-0 text-accent" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-[0.875rem] text-fg-muted">{t.searchPlaceholder}</span>
        <span className={`${chip} shrink-0`}>Ctrl K</span>
      </m.div>
      <m.ul variants={rise} className="flex flex-col divide-y divide-border border border-border text-[0.875rem] rounded-panel">
        {t.searchResults.map((r, i) => (
          <m.li key={i} variants={slide} className={`px-3 py-2 ${i === 0 ? "bg-surface-2 text-fg" : "text-fg-muted"}`}>
            {r}
          </m.li>
        ))}
      </m.ul>
    </Stage>
  );
}

export function ChatMock({ t }: Props) {
  return (
    <div className="grid grid-cols-[auto_1fr]">
      <ul className="hidden flex-col gap-1 border-r border-border p-3 text-small sm:flex">
        {["general", "trading", "alphas", "bounties"].map((c) => (
          <li key={c} className={`flex items-center gap-1.5 px-2 py-1 rounded-control ${c === "trading" ? "bg-surface-2 text-fg" : "text-fg-muted"}`}>
            <Hash className="size-3.5" strokeWidth={1.75} />
            {c}
          </li>
        ))}
      </ul>
      <Stage className="flex min-w-0 flex-col gap-3 p-4 text-[0.875rem]" gap={0.12}>
        <m.div variants={rise} className="flex flex-col gap-0.5">
          <span className={mono}>@dani · 18:02</span>
          <p>
            {t.chatAsk} <span className="bg-surface-2 px-1 text-accent rounded-control">@marta</span> {t.chatAskTail}
          </p>
        </m.div>
        <m.div variants={rise} className="flex flex-col gap-1">
          <span className={mono}>@marta · 18:04</span>
          <p>{t.chatAnswer}</p>
          <div className="flex gap-1.5">
            <m.span variants={pop} className={chip}>
              +1 <span className="text-fg">7</span>
            </m.span>
            <m.span variants={pop} className={chip}>
              {t.thanks} <span className="text-fg">3</span>
            </m.span>
          </div>
        </m.div>
        <m.div variants={rise} className="flex flex-col gap-2 border border-border-strong p-3 rounded-panel">
          <span className="text-[0.8125rem] font-bold">{t.pollTitle}</span>
          {[
            [t.pollOptions[0], "w-[64%]", "64 %"],
            [t.pollOptions[1], "w-[36%]", "36 %"],
          ].map(([label, width, pct]) => (
            <div key={label} className="flex items-center gap-3 text-[0.8125rem]">
              <span className="w-14 shrink-0">{label}</span>
              <span className="relative h-2 flex-1 bg-surface-2">
                <m.span variants={grow} className={`absolute inset-y-0 left-0 block origin-left bg-accent ${width}`} />
              </span>
              <span className={`${mono} w-9 text-right tabular-nums`}>{pct}</span>
            </div>
          ))}
        </m.div>
      </Stage>
    </div>
  );
}

export function AlphaMock({ t }: Props) {
  return (
    <Stage className="flex flex-col gap-4 p-4 sm:p-5" gap={0.1}>
      <m.div variants={rise} className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-display text-xl font-extrabold semiwide">$FARO</span>
        <m.span variants={pop} className={`${chip} border-accent text-accent`}>
          <ShieldCheck className="size-3" strokeWidth={2} />
          {t.verified}
        </m.span>
      </m.div>
      <m.p variants={rise} className={`${mono} break-all`}>
        0x7a3f…c91e
      </m.p>
      <m.div variants={rise} className="border border-border p-3 rounded-panel">
        <svg viewBox="0 0 640 160" className="block h-auto w-full">
          {[40, 80, 120].map((y) => (
            <line key={y} x1="0" x2="640" y1={y} y2={y} stroke="var(--border)" strokeWidth="1" />
          ))}
          <m.path
            variants={draw}
            d="M0 140 L56 128 L104 134 L160 108 L208 114 L264 84 L312 92 L364 62 L412 72 L464 42 L516 54 L572 24 L640 30"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="3"
            strokeLinejoin="round"
          />
        </svg>
        <span className={`${mono} mt-2 block`}>{t.chartCaption}</span>
      </m.div>
      <m.p variants={rise} className="text-[0.875rem]">
        <span className="text-fg-muted">{t.thesisLead}</span> {t.thesis}
      </m.p>
    </Stage>
  );
}

export function BountyMock({ t }: Props) {
  return (
    <Stage className="flex flex-col gap-3 p-4 sm:p-5 text-[0.875rem]" gap={0.14}>
      <m.div variants={rise} className="flex flex-wrap items-center justify-between gap-2">
        <span className={`${chip} text-fg`}>{t.bounty}</span>
        <span className="font-mono text-lg font-bold text-accent tabular-nums">150 USDC</span>
      </m.div>
      <m.p variants={rise} className="font-display text-lg leading-tight font-extrabold semiwide">
        {t.bountyQuestion}
      </m.p>
      <m.div variants={rise} className="flex flex-col gap-1 border border-border p-3 rounded-panel">
        <span className={mono}>@lucia</span>
        <p className="text-fg-muted">{t.bountyReply}</p>
      </m.div>
      <m.div variants={rise} className="relative flex flex-col gap-1 border border-accent p-3 rounded-panel">
        <m.span variants={pop} className={`${chip} absolute -top-3 right-3 border-accent bg-bg text-accent`}>
          <Trophy className="size-3" strokeWidth={2} />
          {t.bestAnswer}
        </m.span>
        <span className={mono}>@pablo</span>
        <p>{t.bountyAnswer}</p>
      </m.div>
      <m.p variants={rise} className={`${mono} flex items-center gap-1.5`}>
        <Check className="size-3.5 text-accent" strokeWidth={2} />
        {t.paidTo} @pablo · tx 0x91c4…07ab
      </m.p>
    </Stage>
  );
}

export function TipsMock({ t }: Props) {
  const tips = [
    ["@dani", "@marta", "0.005 ETH", t.tips[0]],
    ["@noa", "@iker", "10 USDC", t.tips[1]],
    ["@pablo", "@lucia", "0.002 ETH", t.tips[2]],
  ];
  return (
    <Stage className="flex flex-col gap-3 overflow-hidden p-4 sm:p-5" gap={0.18}>
      {tips.map(([from, to, amount, why]) => (
        <m.div key={from} variants={slide} className="flex items-center justify-between gap-3 border border-border bg-bg p-3 rounded-panel">
          <div className="flex min-w-0 flex-col">
            <span className="text-[0.875rem]">
              <span className="text-fg-muted">{from} →</span> {to}
            </span>
            <span className={`${mono} truncate`}>{why}</span>
          </div>
          <div className="flex shrink-0 flex-col items-end">
            <span className="font-mono text-[0.875rem] font-bold text-accent tabular-nums">+{num(t, amount)}</span>
            <span className={`${mono} flex items-center gap-1`}>
              <Check className="size-3" strokeWidth={2} />
              on-chain
            </span>
          </div>
        </m.div>
      ))}
    </Stage>
  );
}

export function TreasuryMock({ t }: Props) {
  return (
    <Stage className="flex flex-col gap-5 p-4 sm:p-5" gap={0.1}>
      <m.div variants={rise} className="flex flex-col gap-2">
        <span className={mono}>{t.safeBalances}</span>
        <div className="grid grid-cols-2 gap-2">
          {[
            ["Base", "2,140 USDC"],
            ["Arbitrum", "0.85 ETH"],
          ].map(([net, bal]) => (
            <m.span key={net} variants={rise} className="flex flex-col gap-1 border border-border p-3 rounded-control">
              <span className={mono}>{net}</span>
              <span className="font-mono text-[1rem] font-bold tabular-nums">{num(t, bal)}</span>
            </m.span>
          ))}
        </div>
      </m.div>
      <m.div variants={rise} className="flex flex-col gap-2">
        <span className={mono}>{t.recentDonations}</span>
        <m.ul variants={rise} className="flex flex-col divide-y divide-border border-t border-border text-[0.875rem]">
          {[
            ["@marta", "25 USDC"],
            ["@iker", "0.01 ETH"],
            ["@dani", "5 USDC"],
          ].map(([who, amount]) => (
            <li key={who} className="flex items-center justify-between py-1.5">
              <span className="flex items-center gap-2">
                {who}
                <m.span variants={pop} className={`${chip} border-accent text-accent`}>
                  Mecenas
                </m.span>
              </span>
              <span className="font-mono text-fg-muted tabular-nums">{num(t, amount)}</span>
            </li>
          ))}
        </m.ul>
      </m.div>
      <m.div variants={rise} className={`${mono} flex items-center gap-1.5`}>
        <ShieldCheck className="size-3.5" strokeWidth={1.75} />
        {t.spend}
      </m.div>
    </Stage>
  );
}

export function RafflePollMock({ t }: Props) {
  return (
    <Stage className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5" gap={0.14}>
      <m.div variants={rise} className="flex flex-col gap-2 border border-border p-3 rounded-panel">
        <span className="text-[0.8125rem] font-bold">{t.raffle}</span>
        <span className={mono}>{t.raffleStepOne}</span>
        <span className="font-mono text-[0.6875rem] break-all text-fg">0x3b9e…a71f</span>
        <span className={mono}>{t.raffleStepTwo} {num(t, "28,341,907")}</span>
        <m.span variants={pop} className={`${chip} w-fit border-accent text-accent`}>
          <Trophy className="size-3" strokeWidth={2} />
          {t.raffleWinner}
        </m.span>
      </m.div>
      <m.div variants={rise} className="flex flex-col gap-2 border border-border p-3 rounded-panel">
        <span className="text-[0.8125rem] font-bold">{t.raffleQuestion}</span>
        {t.raffleOptions.map((o, i) => (
          <span key={o} className={`flex items-center gap-2 border px-2 py-1.5 text-[0.8125rem] rounded-control ${i === 0 ? "border-accent" : "border-border"}`}>
            <span className={`inline-block size-2.5 border ${i === 0 ? "border-accent bg-accent" : "border-border-strong"}`} />
            {o}
          </span>
        ))}
        <span className={`${mono} flex items-center gap-1.5`}>
          <Lock className="size-3" strokeWidth={2} />
          {t.oneVote}
        </span>
      </m.div>
    </Stage>
  );
}

const COINS: [string, string, string, string][] = [
  ["ETH", "3,412.08 USD", "+2.4 %", "M0 20 L10 18 L20 19 L30 14 L40 15 L50 10 L60 11 L70 6 L80 4"],
  ["ARB", "0.4120 USD", "+6.1 %", "M0 22 L10 21 L20 16 L30 18 L40 12 L50 13 L60 8 L70 9 L80 3"],
  ["BTC", "98,104 USD", "−0.8 %", "M0 8 L10 10 L20 9 L30 13 L40 12 L50 15 L60 14 L70 17 L80 16"],
  ["USDC", "1.00 USD", "0.0 %", "M0 13 L20 13 L40 12 L60 13 L80 13"],
];

export function MarketMock({ t }: Props) {
  return (
    <Stage as="ul" className="flex flex-col p-2 sm:p-3" gap={0.1}>
      {COINS.map(([sym, price, change, path]) => (
        <m.li key={sym} variants={rise} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 border-b border-border px-2 py-3 last:border-b-0 sm:grid-cols-[5rem_1fr_6rem_auto]">
          <span className="font-mono text-[0.875rem] font-bold">{sym}</span>
          <span className="font-mono text-[0.875rem] tabular-nums">{num(t, price)}</span>
          <svg viewBox="0 0 80 26" className="hidden h-6 w-24 sm:block" aria-hidden>
            <m.path variants={draw} d={path} fill="none" stroke={change.startsWith("−") ? "var(--danger)" : "var(--accent)"} strokeWidth="1.5" />
          </svg>
          <span className={`font-mono text-[0.8125rem] tabular-nums ${change.startsWith("−") ? "text-danger" : "text-fg-muted"}`}>{num(t, change)}</span>
        </m.li>
      ))}
    </Stage>
  );
}

export function ModerationMock({ t }: Props) {
  return (
    <Stage className="grid gap-3 p-4 sm:grid-cols-[1fr_1.3fr] sm:p-5" gap={0.1}>
      <m.ul variants={rise} className="flex flex-col gap-1.5 text-[0.875rem]">
        {[
          [t.roles[0], "bg-[var(--chart-1)]"],
          [t.roles[1], "bg-[var(--chart-2)]"],
          [t.roles[2], "bg-[var(--chart-4)]"],
          [t.roles[3], "bg-[var(--chart-rest)]"],
        ].map(([role, color]) => (
          <li key={role} className="flex items-center gap-2 border border-border px-2 py-1.5 rounded-control">
            <span className={`inline-block size-2.5 ${color}`} />
            {role}
          </li>
        ))}
      </m.ul>
      <div className="flex flex-col gap-3">
        <m.div variants={rise} className="flex flex-col gap-1 border border-border p-3 text-[0.8125rem] rounded-panel">
          <span className="flex items-center gap-1.5 font-bold">
            <Lock className="size-3.5" strokeWidth={2} />
            #veteranos
          </span>
          <span className="text-fg-muted">{t.requirement}</span>
        </m.div>
        <m.div variants={rise} className="flex flex-col gap-2 border border-warning p-3 text-[0.8125rem] rounded-panel">
          <span className="flex items-center gap-1.5 font-mono break-all text-fg">
            <ArrowUpRight className="size-3.5 shrink-0" strokeWidth={2} />
            airdrop-gratis.example/claim
          </span>
          <m.span variants={pop} className="flex items-start gap-1.5 text-fg">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning" strokeWidth={2} />
            {t.unknownDomain}
          </m.span>
        </m.div>
      </div>
    </Stage>
  );
}
