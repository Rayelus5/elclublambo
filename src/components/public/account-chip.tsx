"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createBrowserClient } from "@/lib/supabase/browser";
import { shortAddress } from "@/lib/auth/wallet";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";

type Props = { lang: Lang; wallet: string; isMember?: boolean };

export function AccountChip({ lang, wallet, isMember = false }: Props) {
  const t = getDictionary(lang);
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await createBrowserClient().auth.signOut();
    } finally {
      router.refresh();
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2" aria-label={t.connect.account} role="group">
      {isMember ? (
        <Link
          href="/"
          className="inline-flex min-h-11 items-center px-2 text-sm font-bold text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent rounded-control"
        >
          {t.connect.goClub}
        </Link>
      ) : null}
      <span className="hidden font-mono text-[13px] text-fg-muted sm:inline">{shortAddress(wallet)}</span>
      <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={signOut}>
        <LogOut aria-hidden />
        {t.common.disconnect}
      </Button>
    </div>
  );
}
