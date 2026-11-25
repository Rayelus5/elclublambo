import { BadgeCheck, Fuel, Gift, ScanSearch, Send, ShieldOff, Wallet, type LucideIcon } from "lucide-react";
import { ToolCard } from "@/components/public/tool-card";
import { getCachedSiteState } from "@/lib/admin/site-state-cached";
import { SWITCH_KEYS, type ToolKey } from "@/lib/admin/state";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { localizedPath, type RouteKey } from "@/lib/i18n/routes";

type Card = { key: ToolKey; icon: LucideIcon; copy: "giveaways" | "pay" | "checker" | "guarantees" | "approvals" | "multisend" | "gas"; route: RouteKey };

export const CARDS: readonly Card[] = [
  { key: "giveaways", icon: Gift, copy: "giveaways", route: "giveaways" },
  { key: "pay", icon: Wallet, copy: "pay", route: "payTool" },
  { key: "checker", icon: ScanSearch, copy: "checker", route: "checker" },
  { key: "vouches", icon: BadgeCheck, copy: "guarantees", route: "vouches" },
  { key: "approvals", icon: ShieldOff, copy: "approvals", route: "approvals" },
  { key: "multisend", icon: Send, copy: "multisend", route: "multisend" },
  { key: "gas", icon: Fuel, copy: "gas", route: "gas" },
];

/** The hub's seven cards. A tool switched off stays in place, dimmed, without a link and «Not available right now». */
export function ToolGrid({ lang, off }: { lang: Lang; off: ReadonlySet<ToolKey> }) {
  const t = getDictionary(lang).tools;
  return (
    <ul aria-label={t.listLabel} className="grid gap-4 sm:grid-cols-2">
      {CARDS.map(({ key, icon, copy, route }) =>
        off.has(key) ? (
          <ToolCard key={key} icon={icon} name={t[copy].name} text={t[copy].text} status={t.unavailableNow} dimmed />
        ) : (
          <ToolCard key={key} icon={icon} name={t[copy].name} text={t[copy].text} status={t.available} href={localizedPath(lang, route)} />
        ),
      )}
    </ul>
  );
}

/** The switches that are off (A-R16), from the tagged cache: the page stays static, Administración expires it on change. */
export async function offTools(): Promise<ReadonlySet<ToolKey>> {
  const { switches } = await getCachedSiteState();
  return new Set(SWITCH_KEYS.filter((k): k is ToolKey => k !== "registration" && !switches[k]));
}

export async function ToolGridLive({ lang }: { lang: Lang }) {
  return <ToolGrid lang={lang} off={await offTools()} />;
}
