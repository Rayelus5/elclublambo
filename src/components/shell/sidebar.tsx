import Link from "next/link";
import { Home, Ticket, Users } from "lucide-react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { ChannelTree } from "@/components/shell/channel-tree";
import { buildTree, type ChannelRow } from "@/lib/channels/tree";
import { NavLink } from "@/components/shell/nav-link";
import { Topbar } from "@/components/shell/topbar";
import { shortAddress } from "@/lib/auth/wallet";
import { hasPerm, Perm } from "@/lib/permissions/bits";

type Props = { perms: bigint; wallet: `0x${string}`; channels?: ChannelRow[] };

function SidebarBody({ perms, wallet, channels = [] }: Props) {
  const tree = buildTree(channels);
  return (
    <div className="flex h-full flex-col gap-4 py-6">
      <Link
        href="/"
        className="px-4 font-display text-2xl font-black tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        El Club.
      </Link>

      <nav aria-label="Principal" className="flex flex-col gap-1">
        <NavLink href="/">
          <Home className="size-4" aria-hidden />
          Inicio
        </NavLink>
        {hasPerm(perms, Perm.CREATE_INVITES) ? (
          <NavLink href="/invites">
            <Ticket className="size-4" aria-hidden />
            Invitaciones
          </NavLink>
        ) : null}
        {hasPerm(perms, Perm.BAN_MEMBERS) ? (
          <NavLink href="/admin/members">
            <Users className="size-4" aria-hidden />
            Miembros
          </NavLink>
        ) : null}
      </nav>

      <nav aria-label="Canales" className="min-h-0 flex-1 overflow-y-auto border-t border-border pt-2">
        <ChannelTree nodes={tree} />
      </nav>

      <div className="flex flex-col gap-3 border-t border-border px-4 pt-4">
        <Link
          href={`/u/${wallet}`}
          className="flex min-h-11 flex-col justify-center rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <span className="text-sm font-bold text-fg">Mi perfil</span>
          <span className="font-mono text-[13px] text-fg-muted">{shortAddress(wallet)}</span>
        </Link>
        <SignOutButton label="Salir" />
      </div>
    </div>
  );
}

export function Sidebar(props: Props) {
  return (
    <>
      <Topbar>
        <SidebarBody {...props} />
      </Topbar>
      <aside className="sticky top-0 hidden h-dvh border-r border-border bg-surface md:block">
        <SidebarBody {...props} />
      </aside>
    </>
  );
}
