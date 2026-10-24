"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { m } from "motion/react";
import { AtSign, Dices, HandHeart, Inbox, Target, Vote, type LucideIcon } from "lucide-react";
import { Countdown } from "@/components/giveaways/countdown";
import { useSearch } from "@/components/search/search-provider";
import { rise, Stage } from "@/components/start/motion";
import { useUnread } from "@/lib/chat/unread";
import { messageHref, type HomeHighlights } from "@/lib/home/queries";
import { cn } from "@/lib/utils";

const TILE =
  "flex h-full min-h-11 flex-col gap-3 rounded-panel border border-border bg-surface p-4 text-fg no-underline outline-none transition-colors duration-150 ease-out hover:border-border-strong hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg motion-reduce:transition-none";

// Four count tiles always; a giveaway and a poll add wider ones. Columns follow the content column (container queries:
// the sidebar and the rail leave it narrow at lg), so there is never a lone tile in a row.
const GRID: Record<number, string> = {
  0: "@lg:grid-cols-4",
  1: "@lg:grid-cols-4 @5xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,2fr)]",
  2: "@lg:grid-cols-4 @5xl:grid-cols-[repeat(4,minmax(0,1fr))_repeat(2,minmax(0,2fr))]",
};
const WIDE: Record<number, string> = {
  1: "col-span-2 @lg:col-span-4 @5xl:col-span-1",
  2: "col-span-2 @5xl:col-span-1",
};

function Tile({
  href,
  icon: Icon,
  label,
  active = false,
  className,
  children,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  active?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <m.li variants={rise} className={cn("@container min-w-0", className)}>
      <Link href={href} className={TILE}>
        <span className="flex items-center gap-2 text-small text-fg-muted">
          <Icon aria-hidden className="size-4 shrink-0" />
          <span className="truncate">{label}</span>
          {active ? <span aria-hidden className="ml-auto size-2 shrink-0 bg-accent" /> : null}
        </span>
        {children}
      </Link>
    </m.li>
  );
}

const Count = ({ children }: { children: ReactNode }) => (
  <span className="wide font-display text-[clamp(2rem,26cqi,3rem)] leading-none font-black tracking-[-0.03em]">{children}</span>
);
const Word = ({ children }: { children: ReactNode }) => (
  <span className="font-display text-[clamp(1.5rem,16cqi,2.5rem)] leading-none font-black tracking-[-0.02em] break-words">
    {children}
  </span>
);
const Title = ({ children }: { children: ReactNode }) => (
  <span className="line-clamp-2 font-display text-lg leading-tight font-extrabold break-words">{children}</span>
);

/**
 * Inicio's quick access row. Unread comes from the live unread set (useUnread) once it has answered, so it can read
 * «Al día»; until then the server's newest-first list stands in (`unreadOrder`), so the server HTML already shows the
 * real count. `highlights` null (their read failed): Sin leer and Menciones still show, Bounties says it is not
 * available, Donaciones shows «Donar» and there is no giveaway or poll tile.
 */
export function QuickTiles({
  highlights,
  mentions,
  unreadOrder = [],
  bountyHref,
}: {
  highlights: HomeHighlights | null;
  /** Unread mentions plus replies. */
  mentions: number;
  /** Channel ids with unread messages, newest first (home_unread_channels). */
  unreadOrder?: readonly string[];
  /** The first open bounty; the guide when there is none. */
  bountyHref?: string;
}) {
  const { unread, loaded } = useUnread();
  const { channels } = useSearch();
  const ids = loaded || unread.size > 0 ? [...unreadOrder.filter((id) => unread.has(id)), ...[...unread].filter((id) => !unreadOrder.includes(id))] : unreadOrder;
  const firstText = channels.filter((c) => c.kind === "text").toSorted((a, b) => a.position - b.position)[0];
  const unreadHref = ids[0] ? `/c/${ids[0]}` : firstText ? `/c/${firstText.id}` : "/guia";

  const giveaway = highlights?.giveaway ?? null;
  const poll = highlights?.poll ?? null;
  const isMecenas = highlights?.donor.isMecenas ?? false;
  const openBounties = highlights?.openBounties ?? 0;
  const events = (giveaway ? 1 : 0) + (poll ? 1 : 0);

  return (
    <Stage as="ul" label="Accesos rápidos" gap={0.04} amount={0.2} className={cn("grid grid-cols-2 gap-3", GRID[events])}>
      <Tile href={unreadHref} icon={Inbox} label="Sin leer" active={ids.length > 0}>
        {ids.length > 0 ? <Count>{ids.length}</Count> : <Word>Al día</Word>}
      </Tile>
      <Tile href="/notifications" icon={AtSign} label="Menciones" active={mentions > 0}>
        <Count>{mentions}</Count>
      </Tile>
      <Tile href={openBounties > 0 && bountyHref ? bountyHref : "/guia/bounties"} icon={Target} label="Bounties">
        {highlights ? (
          <Count>{openBounties}</Count>
        ) : (
          <>
            <Count>
              <span aria-hidden>—</span>
            </Count>
            <span className="text-small text-fg-muted">No disponible</span>
          </>
        )}
      </Tile>
      <Tile href="/donar" icon={HandHeart} label="Donaciones" active={isMecenas}>
        <Word>{isMecenas ? "Mecenas" : "Donar"}</Word>
      </Tile>
      {giveaway ? (
        <Tile href={`/sorteos/${giveaway.id}`} icon={Dices} label="Sorteo" active={giveaway.iEntered} className={WIDE[events]}>
          <Title>{giveaway.title}</Title>
          <span className="mt-auto text-small text-fg-muted">
            <Countdown closesAt={giveaway.closesAt} endedText="Cerrado" />
            {giveaway.iEntered ? " · Participas" : null}
          </span>
        </Tile>
      ) : null}
      {poll ? (
        <Tile href={messageHref(poll.channelId, poll.messageId)} icon={Vote} label="Encuesta" className={WIDE[events]}>
          <Title>{poll.question}</Title>
          <span className="mt-auto text-small text-fg-muted">
            <Countdown closesAt={poll.closesAt} endedText="Cerrada" />
          </span>
        </Tile>
      ) : null}
    </Stage>
  );
}
