import { clubPath } from "@/lib/club/paths";
import Link from "next/link";
import { BookOpen, ChartCandlestick, Dices, Flag, HandHeart, Home, LifeBuoy, Settings, Ticket, User, Users } from "lucide-react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { ChannelTree } from "@/components/shell/channel-tree";
import { buildTree, type ChannelRow } from "@/lib/channels/tree";
import { MoreMenu } from "@/components/shell/more-menu";
import { NavLink } from "@/components/shell/nav-link";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { SearchButton } from "@/components/search/search-button";
import { Topbar } from "@/components/shell/topbar";
import { shortAddress } from "@/lib/auth/wallet";
import { hasPerm, Perm } from "@/lib/permissions/bits";
import { TestModeBadge } from "@/components/economy/test-mode-badge";

type Props = {
  perms: bigint;
  wallet: `0x${string}`;
  channels?: ChannelRow[];
  /** MANAGE_MESSAGES in at least one visible channel (has_any_channel_perm): the same rule as the page's 404. */
  canModerate?: boolean;
  /** Open tickets the member can read (their own, plus the ones they support): RLS decides which. */
  openTickets?: number;
};

const brandClass =
  "font-display font-black tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

/** The sections the member may open, in order. Each entry is gated by the same rule as its page. */
function sections({ perms, canModerate = false, openTickets = 0 }: Props) {
  return [
    { href: clubPath(), text: "Inicio", Icon: Home },
    {
      href: clubPath("/tickets"),
      text: "Tickets",
      Icon: LifeBuoy,
      label: openTickets > 0 ? `Tickets, ${openTickets} ${openTickets === 1 ? "abierto" : "abiertos"}` : undefined,
      badge: openTickets > 0 ? (openTickets > 9 ? "9+" : String(openTickets)) : undefined,
    },
    { href: clubPath("/guia"), text: "Guía", Icon: BookOpen },
    { href: clubPath("/donar"), text: "Donar", Icon: HandHeart },
    { href: clubPath("/mercado"), text: "Mercado", Icon: ChartCandlestick },
    { href: clubPath("/sorteos"), text: "Sorteos", Icon: Dices },
    hasPerm(perms, Perm.CREATE_INVITES) && { href: clubPath("/invites"), text: "Invitaciones", Icon: Ticket },
    (hasPerm(perms, Perm.BAN_MEMBERS) || hasPerm(perms, Perm.VERIFY_MEMBERS)) && {
      href: clubPath("/admin/members"),
      text: "Miembros",
      Icon: Users,
      staff: true,
    },
    canModerate && { href: clubPath("/moderation/reports"), text: "Reportes", Icon: Flag, staff: true },
    (hasPerm(perms, Perm.MANAGE_CHANNELS) || hasPerm(perms, Perm.MANAGE_ROLES)) && {
      href: clubPath("/settings"),
      text: "Ajustes",
      Icon: Settings,
      staff: true,
    },
  ].flatMap((s) => (s ? [s] : []));
}

/**
 * ≥768px: brand, the sections as tabs, and search, notices, profile and sign out on the right.
 *
 * Fixed budget, so nothing can slide under the right-hand controls: the tabs are the member sections (at most 7) plus
 * one «Más» menu that holds the staff-only ones (Miembros, Reportes, Ajustes). The controls never shrink; the tabs do
 * (a label truncates before a tab overlaps anything). Below 1280px tabs are icon-only, the network badge and the
 * search are compact until 1536px, and the profile / sign-out lose their text below 1024px.
 */
function DesktopBar(props: Props) {
  const all = sections(props);
  const tabs = all.filter((s) => !("staff" in s));
  const more = all.flatMap((s) => ("staff" in s ? [{ href: s.href, text: s.text, icon: <s.Icon className="size-4" aria-hidden /> }] : []));
  return (
    <header className="sticky top-(--mnt-banner-h) z-40 hidden h-14 items-center gap-2 border-b border-border bg-bg pr-2 pl-4 md:col-span-2 md:flex lg:col-span-3">
      <Link href={clubPath()} className={`mr-2 inline-flex min-h-11 items-center text-xl ${brandClass}`}>
        El Club.
      </Link>
      <nav aria-label="Principal" className="min-w-0 self-stretch overflow-hidden">
        <ul className="flex h-full flex-row">
          {tabs.map(({ href, text, Icon, label, badge }) => (
            <li key={href} className="min-w-11 shrink">
              <NavLink href={href} variant="top" label={label} badge={badge}>
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="sr-only min-w-0 xl:not-sr-only xl:truncate">{text}</span>
              </NavLink>
            </li>
          ))}
          {more.length > 0 ? (
            <li className="shrink-0">
              <MoreMenu items={more} />
            </li>
          ) : null}
        </ul>
      </nav>
      <div data-testid="bar-controls" className="ml-auto flex shrink-0 items-center gap-1">
        <TestModeBadge responsive className="mr-1" />
        <SearchButton variant="bar" />
        <NotificationBell />
        <Link
          href={clubPath(`/u/${props.wallet}`)}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control px-2 font-mono text-[13px] text-fg-muted outline-none hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <User className="size-4 lg:hidden" aria-hidden />
          <span className="sr-only">Mi perfil, </span>
          <span className="sr-only font-mono lg:not-sr-only">{shortAddress(props.wallet)}</span>
        </Link>
        <SignOutButton label="Salir" collapse />
      </div>
    </header>
  );
}

/** <768px drawer: everything stacked (sections, channels, profile). */
function DrawerBody(props: Props) {
  const tree = buildTree(props.channels ?? []);
  return (
    <div className="flex flex-col gap-4 py-6">
      <Link href={clubPath()} className={`px-4 text-2xl ${brandClass}`}>
        El Club.
      </Link>
      <TestModeBadge className="mx-4 self-start" />

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
          href={clubPath(`/u/${props.wallet}`)}
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
      <Topbar badge={<TestModeBadge compact className="mr-1" />}>
        <DrawerBody {...props} />
      </Topbar>
      <aside className="sticky top-[calc(3.5rem+var(--mnt-banner-h))] hidden h-[calc(100dvh-3.5rem-var(--mnt-banner-h))] border-r border-border bg-surface md:block">
        <nav aria-label="Canales" className="h-full overflow-y-auto py-4">
          <ChannelTree nodes={buildTree(props.channels ?? [])} />
        </nav>
      </aside>
    </>
  );
}
