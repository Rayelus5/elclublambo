import { Suspense } from "react";
import { redirect } from "next/navigation";
import { walletFromUser } from "@/lib/auth/wallet";
import { createServerClient } from "@/lib/supabase/server";

// Same session / membership / ban checks as the forum shell, without the shell. Reads cookies: inside a Suspense.
async function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: status } = await supabase.rpc("my_membership_status");
  if (status === "banned") redirect("/banned");
  if (status !== "active") redirect("/no-access");
  if (!walletFromUser(user)) redirect("/login");

  return <>{children}</>;
}

export default function OnboardingLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center gap-8 px-4 py-12 sm:px-6 sm:py-16">
      <Suspense fallback={<div className="min-h-dvh" aria-hidden />}>
        <OnboardingGuard>
          <div className="flex flex-col gap-8 duration-200 ease-out animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none">
            {children}
          </div>
        </OnboardingGuard>
      </Suspense>
    </main>
  );
}
