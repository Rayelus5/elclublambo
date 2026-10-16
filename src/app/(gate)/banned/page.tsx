import { SignOutButton } from "@/components/auth/sign-out-button";

export default function BannedPage() {
  return (
    <>
      <header className="flex flex-col gap-4">
        <h1 className="text-h1">Cuenta suspendida</h1>
        <p className="text-fg-muted">
          El acceso de esta cuenta al club está suspendido. Si crees que es un error, habla con quien
          te invitó.
        </p>
      </header>
      <section aria-label="Cerrar sesión" className="border border-border bg-surface p-6 rounded-panel">
        <SignOutButton label="Cerrar sesión" />
      </section>
    </>
  );
}
