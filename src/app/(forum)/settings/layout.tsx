import { Suspense } from "react";
import { notFound } from "next/navigation";
import { SettingsNav } from "@/components/settings/settings-nav";
import { settingsSections } from "@/lib/permissions/settings";
import { createServerClient } from "@/lib/supabase/server";

// Lee cookies (dinámico): con cacheComponents debe vivir dentro de un Suspense.
async function SettingsShell({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient();
  const { data: rawPerms } = await supabase.rpc("my_permissions");
  const sections = settingsSections(BigInt(String(rawPerms ?? 0)));
  if (sections.length === 0) notFound();

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <h1 className="text-h1">Ajustes</h1>
      <div className="grid gap-6 md:grid-cols-[10rem_minmax(0,1fr)]">
        <SettingsNav sections={sections} />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <Suspense fallback={<div className="min-h-64" aria-hidden />}>
      <SettingsShell>{children}</SettingsShell>
    </Suspense>
  );
}
