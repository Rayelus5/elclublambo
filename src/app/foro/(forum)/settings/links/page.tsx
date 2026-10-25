import { Suspense } from "react";
import { PageLoader } from "@/components/shell/page-loader";
import { notFound } from "next/navigation";
import { DomainList } from "@/components/settings/domain-list";
import { hasPerm, Perm } from "@/lib/permissions/bits";
import { createServerClient } from "@/lib/supabase/server";

async function LinksContent() {
  const supabase = await createServerClient();
  const { data: rawPerms } = await supabase.rpc("my_permissions");
  if (!hasPerm(BigInt(String(rawPerms ?? 0)), Perm.MANAGE_CHANNELS)) notFound();

  const { data, error } = await supabase
    .from("allowed_domains")
    .select("domain")
    .order("domain")
    .returns<{ domain: string }[]>();
  if (error) throw error;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h2 className="text-h2">Enlaces</h2>
        <p className="text-fg-muted">
          Dominios desde los que se permiten enlaces en los mensajes.
        </p>
      </header>
      <DomainList domains={(data ?? []).map((d) => d.domain)} />
    </div>
  );
}

export default function LinksSettingsPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <LinksContent />
    </Suspense>
  );
}
