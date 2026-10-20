import { Suspense } from "react";
import { PageLoader } from "@/components/shell/page-loader";
import { notFound } from "next/navigation";
import { EconomyForm } from "@/components/economy/economy-form";
import { getEconomyConfig } from "@/lib/economy/config";
import { createServerClient } from "@/lib/supabase/server";

async function EconomyContent() {
  const supabase = await createServerClient();
  const { data: rawPerms } = await supabase.rpc("my_permissions");
  // Bit 512 only (SuperAdmin), matching the section in settingsSections.
  if ((BigInt(String(rawPerms ?? 0)) & 512n) === 0n) notFound();

  const config = await getEconomyConfig();
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h2 className="text-h2">Economía</h2>
        <p className="text-fg-muted">Red activa, comisión mínima y direcciones de la Safe y de la plataforma por red.</p>
      </header>
      <EconomyForm config={config} />
    </div>
  );
}

export default function EconomySettingsPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <EconomyContent />
    </Suspense>
  );
}
