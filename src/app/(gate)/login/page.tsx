import { Suspense } from "react";
import { LoginPanel } from "@/components/auth/login-panel";

async function LoginContent({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { next } = await searchParams;
  return <LoginPanel next={typeof next === "string" ? next : null} />;
}

export default function LoginPage(props: PageProps<"/login">) {
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
    </>
  );
}
