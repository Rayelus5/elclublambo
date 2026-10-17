import { Suspense } from "react";
import { notFound } from "next/navigation";
import { RoleList } from "@/components/settings/role-list";
import { hasPerm, Perm } from "@/lib/permissions/bits";
import { getRolesContext } from "@/lib/roles/queries";

async function RolesContent() {
  const { roles, actor } = await getRolesContext();
  if (!hasPerm(BigInt(actor.perms), Perm.MANAGE_ROLES)) notFound();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h2 className="text-h2">Roles</h2>
        <p className="text-fg-muted">
          Los roles de arriba mandan sobre los de abajo. Solo puedes tocar roles por debajo del tuyo y dar permisos
          que tú tienes.
        </p>
      </header>
      <RoleList roles={roles} actor={actor} />
    </div>
  );
}

export default function RolesSettingsPage() {
  return (
    <Suspense fallback={<div className="min-h-64" aria-hidden />}>
      <RolesContent />
    </Suspense>
  );
}
