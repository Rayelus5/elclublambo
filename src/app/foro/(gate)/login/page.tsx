import { Suspense } from "react";
import Link from "next/link";
import { LoginPanelLazy } from "@/components/auth/login-panel-lazy";

async function LoginContent({ searchParams }: { searchParams: PageProps<"/foro/login">["searchParams"] }) {
  const { next } = await searchParams;
  return <LoginPanelLazy next={typeof next === "string" ? next : null} />;
}

export default function LoginPage(props: PageProps<"/foro/login">) {
  return (
    <>
      <header className="flex flex-col gap-4">
        <h1 className="text-display">El Club.</h1>
        <p className="text-fg-muted">Foro privado. Solo con invitación.</p>
      </header>
      <section aria-label="Acceso" className="border border-border bg-surface p-6 rounded-panel">
        <Suspense fallback={<div className="min-h-11" aria-hidden />}>
          <LoginContent searchParams={props.searchParams} />
        </Suspense>
      </section>
      {/* Para quien llega sin invitación: la landing pública lo explica. */}
      <p className="-mt-4 text-small">
        <Link href="/start" className="inline-flex min-h-11 items-center text-fg-muted underline hover:text-fg">
          ¿Qué es ElClub.?
        </Link>
      </p>
    </>
  );
}
