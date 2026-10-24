import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { WelcomeSteps } from "@/components/onboarding/welcome-steps";
import { getEconomyConfig } from "@/lib/economy/config";
import { chainForKey } from "@/lib/economy/networks";
import { safeNextPath } from "@/lib/onboarding/next-path";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Bienvenida" };

type Params = Promise<{ next?: string | string[]; repetir?: string | string[] }>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// searchParams y cookies son dinámicos: con cacheComponents deben leerse dentro de un Suspense.
async function Welcome({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next) ?? null);
  const replay = first(params.repetir) === "1";

  const supabase = await createServerClient();
  const me = await supabase.rpc("current_member_id");
  if (me.error || typeof me.data !== "string") notFound();
  const [{ data: row }, economy] = await Promise.all([
    supabase
      .from("members")
      .select("handle, welcome_completed_at")
      .eq("id", me.data)
      .maybeSingle<{ handle: string | null; welcome_completed_at: string | null }>(),
    getEconomyConfig(),
  ]);
  if (!row) notFound();
  // Already welcomed and not asking to see it again: straight to where they were going.
  if (row.welcome_completed_at !== null && !replay) redirect(next);

  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">Bienvenida a ElClub.</h1>
        <p className="text-fg-muted">Cuatro pasos rápidos. Solo el primero es obligatorio.</p>
      </header>
      <WelcomeSteps initialHandle={row.handle} next={next} chainIds={economy.enabledChainIds.length > 0 ? economy.enabledChainIds : [chainForKey("base")]} />
    </>
  );
}

export default function WelcomePage({ searchParams }: { searchParams: Params }) {
  return (
    <Suspense fallback={<div className="min-h-64" aria-hidden />}>
      <Welcome searchParams={searchParams} />
    </Suspense>
  );
}
