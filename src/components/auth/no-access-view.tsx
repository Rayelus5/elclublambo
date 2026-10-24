import { SignOutButton } from "@/components/auth/sign-out-button";
import { rpcErrorMessage } from "@/lib/errors";
import { localizedPath } from "@/lib/i18n/routes";

/** `errorCode` must already be allowlisted (see knownErrorCode); it is never rendered raw. */
export function NoAccessView({ errorCode }: { errorCode: string | null }) {
  return (
    <>
      <header className="flex flex-col gap-4">
        <h1 className="text-h1">Sin acceso</h1>
        <p className="text-fg-muted">
          El club es solo con invitación y esta wallet aún no es miembro. Pide a alguien del club que
          te invite y abre su enlace.
        </p>
      </header>
      {errorCode ? (
        <p role="alert" className="border border-danger px-4 py-3 text-[13px] text-danger rounded-control">
          {rpcErrorMessage(errorCode)}
        </p>
      ) : null}
      <section aria-label="Cambiar de wallet" className="border border-border bg-surface p-6 rounded-panel">
        <SignOutButton label="Probar con otra wallet" />
        <a
          href={localizedPath("es", "tools")}
          className="mt-4 inline-flex min-h-11 items-center font-bold text-accent underline-offset-4 hover:underline"
        >
          Ir a herramientas
        </a>
      </section>
    </>
  );
}
