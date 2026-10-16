import { Suspense } from "react";
import { LoginPanelLazy } from "@/components/auth/login-panel-lazy";
import { safeDecode } from "@/lib/auth/safe-decode";
import { rpcErrorMessage } from "@/lib/errors";

async function InviteContent({ props }: { props: PageProps<"/invite/[code]"> }) {
  const [{ code }, { error }] = await Promise.all([props.params, props.searchParams]);
  const errorCode = typeof error === "string" ? error : null;
  return (
    <>
      {errorCode ? (
        <p role="alert" className="border border-danger px-4 py-3 text-[13px] text-danger rounded-control">
          {rpcErrorMessage(errorCode)}
        </p>
      ) : null}
      <LoginPanelLazy inviteCode={safeDecode(code)} />
    </>
  );
}

export default function InvitePage(props: PageProps<"/invite/[code]">) {
  return (
    <>
      <header className="flex flex-col gap-4">
        <h1 className="text-h1">Te han invitado</h1>
        <p className="text-fg-muted">
          Conecta tu wallet y firma para aceptar la invitación y entrar al club. La firma no cuesta
          gas ni mueve fondos.
        </p>
      </header>
      <section aria-label="Aceptar invitación" className="flex flex-col gap-4 border border-border bg-surface p-6 rounded-panel">
        <Suspense fallback={<div className="min-h-11" aria-hidden />}>
          <InviteContent props={props} />
        </Suspense>
      </section>
    </>
  );
}
