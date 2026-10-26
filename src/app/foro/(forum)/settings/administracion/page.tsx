import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AccessList } from "@/components/admin/access-list";
import { AdminHistory } from "@/components/admin/admin-history";
import { MaintenanceForm } from "@/components/admin/maintenance-form";
import { ToolSwitches } from "@/components/admin/tool-switches";
import { PageLoader } from "@/components/shell/page-loader";
import { getAdminOverview } from "@/lib/admin/overview";
import { createServerClient } from "@/lib/supabase/server";

function Section({ id, title, text, children }: { id: string; title: string; text: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 id={id} className="text-h3">
          {title}
        </h3>
        <p className="text-sm text-fg-muted">{text}</p>
      </div>
      {children}
    </section>
  );
}

async function AdministrationContent() {
  const supabase = await createServerClient();
  const { data: rawPerms } = await supabase.rpc("my_permissions");
  // Bit 512 only (SuperAdmin), matching the section in settingsSections.
  if ((BigInt(String(rawPerms ?? 0)) & 512n) === 0n) notFound();

  const overview = await getAdminOverview();
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h2 className="text-h2">Administración</h2>
        <p className="text-fg-muted">Qué está abierto al público, cuándo se cierra la web y quién del equipo entra mientras tanto.</p>
      </header>
      <Section
        id="admin-tools"
        title="Herramientas y funciones públicas"
        text="Una apagada muestra «No disponible» a los visitantes. El foro no se ve afectado."
      >
        <ToolSwitches switches={overview.switches} />
      </Section>
      <Section id="admin-maintenance" title="Mantenimiento" text="Cierra toda la web, pública y foro. Lo automático sigue funcionando.">
        <MaintenanceForm
          maintenance={overview.maintenance}
          passwordSet={overview.passwordSet}
          passwordUpdatedAt={overview.passwordUpdatedAt}
        />
      </Section>
      <Section
        id="admin-access"
        title="Lista de acceso"
        text="Wallets del equipo que pueden entrar durante el mantenimiento firmando y con la contraseña."
      >
        <AccessList items={overview.accessList} />
      </Section>
      <Section id="admin-history" title="Historial" text="Los últimos 50 cambios de administración.">
        <AdminHistory history={overview.history} />
      </Section>
    </div>
  );
}

export default function AdministrationSettingsPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <AdministrationContent />
    </Suspense>
  );
}
