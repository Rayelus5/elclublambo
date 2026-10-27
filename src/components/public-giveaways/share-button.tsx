"use client";

import { useState } from "react";
import { Check, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n";

type Labels = Dictionary["giveaways"]["detail"]["share"];

/** The system share sheet when there is one; otherwise copies the giveaway's public URL (in the page's language). */
export function ShareButton({ path, title, t }: { path: string; title: string; t: Labels }) {
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function share() {
    setNote(null);
    const url = new URL(path, window.location.origin).toString();
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
      } catch {
        // Closing the sheet rejects with AbortError: nothing to say.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setNote(t.copied);
    } catch {
      setNote(t.copyFailed);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" onClick={share}>
        {copied ? <Check aria-hidden /> : <Share2 aria-hidden />}
        {t.share}
      </Button>
      <span role="status" className="text-[13px] text-fg-muted">
        {note}
      </span>
    </div>
  );
}
