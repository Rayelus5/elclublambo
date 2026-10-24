import { Suspense } from "react";
import type { Metadata } from "next";
import { CreateGiveawayTrigger } from "@/components/giveaways/create-giveaway-dialog";
import { GiveawayList } from "@/components/giveaways/giveaway-list";
import { PageLoader } from "@/components/shell/page-loader";
import { appChainIds } from "@/lib/economy/networks";
import { giveawayRoleOptions, type RoleOption } from "@/lib/giveaways/format";
import { getGiveaways } from "@/lib/giveaways/queries";
import { getRolesContext } from "@/lib/roles/queries";
import { safeError } from "@/lib/security/redact";
import { createServerClient } from "@/lib/supabase/server";
import { treasurerId } from "@/lib/treasury/treasurer";

export const metadata: Metadata = { title: "Sorteos" };

/** The roles a treasurer may offer; an empty list if the read fails (the dialog says there are none). */
async function roleOptions(): Promise<RoleOption[]> {
  try {
    return giveawayRoleOptions(await getRolesContext());
  } catch (e) {
    console.error("[giveaways] roles read failed", safeError(e));
    return [];
  }
}

// Reads cookies (dynamic): under cacheComponents it must live inside a Suspense.
async function SorteosContent() {
  const supabase = await createServerClient();
  const [items, treasurer] = await Promise.all([
    getGiveaways(supabase, 30).catch((e: unknown) => {
      console.error("[giveaways] list read failed", safeError(e));
      return null;
    }),
    treasurerId().catch(() => null),
  ]);
  const roles = treasurer ? await roleOptions() : [];

  return (
    <div className="flex w-full flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-h1">Sorteos</h1>
        <p className="max-w-2xl text-fg-muted">
          Gratis: nunca se paga por participar. Todos tienen la misma probabilidad. El azar sale de drand, una red pública, y cualquiera puede
          comprobar los ganadores.
        </p>
        {treasurer ? (
          <div>
            <CreateGiveawayTrigger chains={appChainIds()} roles={roles} />
          </div>
        ) : null}
      </header>

      {items ? <GiveawayList items={items} /> : <p className="text-sm text-danger">No se pudo cargar. Recarga la página.</p>}

      <p role="note" className="border-t border-border pt-4 text-[13px] text-fg-muted">
        ElClub. no custodia fondos: los premios en USDC los paga la Safe del club, que controlan sus firmantes.
      </p>
    </div>
  );
}

export default function SorteosPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <SorteosContent />
    </Suspense>
  );
}
