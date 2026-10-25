import { Suspense } from "react";
import { PageLoader } from "@/components/shell/page-loader";
import { notFound, redirect } from "next/navigation";
import { settingsSections } from "@/lib/permissions/settings";
import { createServerClient } from "@/lib/supabase/server";

async function SettingsRedirect(): Promise<never> {
  const supabase = await createServerClient();
  const { data: rawPerms } = await supabase.rpc("my_permissions");
  const first = settingsSections(BigInt(String(rawPerms ?? 0)))[0];
  if (!first) notFound();
  redirect(first.href);
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <SettingsRedirect />
    </Suspense>
  );
}
