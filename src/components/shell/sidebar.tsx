import Link from "next/link";
import { BookOpen, ChartCandlestick, Flag, Home, Landmark, LifeBuoy, Settings, Ticket, Users } from "lucide-react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { ChannelTree } from "@/components/shell/channel-tree";
import { buildTree, type ChannelRow } from "@/lib/channels/tree";
import { NavLink } from "@/components/shell/nav-link";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { SearchButton } from "@/components/search/search-button";
import { Topbar } from "@/components/shell/topbar";
import { shortAddress } from "@/lib/auth/wallet";
import { hasPerm, Perm } from "@/lib/permissions/bits";
import { NetworkBadge } from "@/components/economy/network-badge";
import type { ChainId } from "@/lib/economy/networks";

type Props = {
  perms: bigint;
  wallet: `0x${string}`;
  channels?: ChannelRow[];
  /** MANAGE_MESSAGES in at least one visible channel (has_any_channel_perm): the same rule as the page's 404. */
  canModerate?: boolean;
  /** Open tickets the member can read (their own, plus the ones they support): RLS decides which. */
  openTickets?: number;
  /** Active network (economy_config): every member sees whether money moves on testnet. */
  chainId?: ChainId;
};

const brandClass =
  "font-display font-black tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

/** The sections the member may open, in order. Each entry is gated by the same rule as its page. */
function sections({ perms, canModerate = false, openTickets = 0 }: Props) {
  return [
    { href: "/", text: "Inicio", Icon: Home },
    {
      href: "/tickets",
      text: "Tickets",
      Icon: LifeBuoy,
      label: openTickets > 0 ? `Tickets, ${openTickets} ${openTickets === 1 ? "abierto" : "abiertos"}` : undefined,
      badge: openTickets > 0 ? (openTickets > 9 ? "9+" : String(openTickets)) : undefined,
    },
    { href: "/guia", text: "Guía", Icon: BookOpen },
    { href: "/dao", text: "DAO", Icon: Landmark },
    { href: "/mercado", text: "Mercado", Icon: ChartCandlestick },
    hasPerm(perms, Perm.CREATE_INVITES) && { href: "/invites", text: "Invitaciones", Icon: Ticket },
    (hasPerm(perms, Perm.BAN_MEMBERS) || hasPerm(perms, Perm.VERIFY_MEMBERS)) && {
      href: "/admin/members",
      text: "Miembros",
      Icon: Users,
    },
    canModerate && { href: "/moderation/reports", text: "Reportes", Icon: Flag },
    (hasPerm(perms, Perm.MANAGE_CHANNELS) || hasPerm(perms, Perm.MANAGE_ROLES)) && {
      href: "/settings",
      text: "Ajustes",
      Icon: Settings,
    },
  ].flatMap((s) => (s ? [s] : []));
}

/** ≥768px: brand, the sections as tabs, and search, notices, profile and sign out on the right. */
function DesktopBar(props: Props) {
  return (
    <header className="sticky top-0 z-40 hidden h-14 items-center gap-2 border-b border-border bg-bg pr-2 pl-4 md:col-span-2 md:flex lg:col-span-3">
      <Link href="/" className={`mr-2 inline-flex min-h-11 items-center text-xl ${brandClass}`}>
        El Club.
      </Link>
      <nav aria-label="Principal" className="min-w-0 self-stretch">
        <ul className="flex h-full flex-row">
          {sections(props).map(({ href, text, Icon, label, badge }) => (
            <li key={href}>
              <NavLink href={href} variant="top" label={label} badge={badge}>
                <Icon className="size-4" aria-hidden />
                <span className="sr-only lg:not-sr-only">{text}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="ml-auto flex items-center gap-1">
        {props.chainId ? <NetworkBadge chainId={props.chainId} className="mr-1" /> : null}
        <SearchButton variant="bar" />
        <NotificationBell />
        <Link
          href={`/u/${props.wallet}`}
          className="inline-flex min-h-11 items-center rounded-control px-2 font-mono text-[13px] text-fg-muted outline-none hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <span className="sr-only">Mi perfil, </span>
          <span className="font-mono">{shortAddress(props.wallet)}</span>
        </Link>
        <SignOutButton label="Salir" />
      </div>
    </header>
  );
}

/** <768px drawer: everything stacked (sections, channels, profile). */
function DrawerBody(props: Props) {
  const tree = buildTree(props.channels ?? []);
  return (
    <div className="flex flex-col gap-4 py-6">
      <Link href="/" className={`px-4 text-2xl ${brandClass}`}>
        El Club.
      </Link>
      {props.chainId ? (
        <div className="px-4">
          <NetworkBadge chainId={props.chainId} />
        </div>
      ) : null}

      <nav aria-label="Principal" className="flex flex-col gap-1">
        {sections(props).map(({ href, text, Icon, label, badge }, i) => (
          <div key={href} className="contents">
            <NavLink href={href} label={label} badge={badge}>
              <Icon className="size-4" aria-hidden />
              {text}
            </NavLink>
            {i === 0 ? (
              <>
                <SearchButton variant="nav" />
                <NotificationBell variant="nav" />
              </>
            ) : null}
          </div>
        ))}
      </nav>

      <nav aria-label="Canales" className="border-t border-border pt-2">
        <ChannelTree nodes={tree} />
      </nav>

      <div className="flex flex-col gap-3 border-t border-border px-4 pt-4">
        <Link
          href={`/u/${props.wallet}`}
          className="flex min-h-11 flex-col justify-center rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <span className="text-sm font-bold text-fg">Mi perfil</span>
          <span className="font-mono text-[13px] text-fg-muted">{shortAddress(props.wallet)}</span>
        </Link>
        <SignOutButton label="Salir" />
      </div>
    </div>
  );
}

/**
 * Forum navigation: the desktop top bar (sections), the channel aside below it, and the mobile top bar with its
 * drawer. Sections and channels stay apart on desktop so the forum tree reads on its own.
 */
export function Sidebar(props: Props) {
  return (
    <>
      <DesktopBar {...props} />
      <Topbar badge={props.chainId ? <NetworkBadge chainId={props.chainId} compact className="mr-1" /> : null}>
        <DrawerBody {...props} />
      </Topbar>
      <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] border-r border-border bg-surface md:block">
        <nav aria-label="Canales" className="h-full overflow-y-auto py-4">
          <ChannelTree nodes={buildTree(props.channels ?? [])} />
        </nav>
      </aside>
    </>
  );
}
