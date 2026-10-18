"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { leavePresence } from "@/lib/members/card";
import { presenceDeviceId } from "@/lib/members/presence";
import { createBrowserClient } from "@/lib/supabase/browser";

export function SignOutButton({ label }: { label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      const supabase = createBrowserClient();
      // Say goodbye while the session still exists, so others see this device go offline at once.
      await leavePresence(supabase, presenceDeviceId()).catch(() => undefined);
      await supabase.auth.signOut();
    } finally {
      router.replace("/login");
      setBusy(false);
    }
  }

  return (
    <Button type="button" size="lg" variant="secondary" disabled={busy} onClick={signOut}>
      <LogOut aria-hidden />
      {label}
    </Button>
  );
}
