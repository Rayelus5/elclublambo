import { SignOutButton } from "@/components/auth/sign-out-button";

export default function NoAccessPage() {
  return (
    <>
      <header className="flex flex-col gap-4">
        <h1 className="text-h1">Sin acceso</h1>
        <p className="text-fg-muted">
          El club es solo con invitación y esta wallet aún no es miembro. Pide a alguien del club que
          te invite y abre su enlace.
        </p>
      </header>
      <section aria-label="Cambiar de wallet" className="border border-border bg-surface p-6 rounded-panel">
        <SignOutButton label="Probar con otra wallet" />
      </section>
    </>
  );
}
