import { clubPath } from "@/lib/club/paths";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * The guide before the welcome is done: only the brand and a way back. No sidebar, channel tree, navigation or search,
 * so there is no forum link to click (client navigations would skip the onboarding gate).
 */
export function OnboardingGuideFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      <header className="flex h-14 items-center justify-between gap-4 border-b border-border bg-bg px-4 sm:px-8">
        <span className="font-display text-xl font-black tracking-tight">El Club.</span>
        <Link
          href={clubPath("/bienvenida")}
          className="inline-flex min-h-11 items-center gap-2 rounded-control text-sm font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Volver a la bienvenida
        </Link>
      </header>
      <main className="min-w-0 px-4 py-8 sm:px-8 md:py-10">{children}</main>
    </div>
  );
}
