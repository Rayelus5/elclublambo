"use client";

import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = { text: string; label: string; doneText: string; failedText: string; disabled?: boolean };

/** Copies `text` to the clipboard; the result is announced politely and the button never moves. */
export function CopyButton({ text, label, doneText, failedText, disabled }: Props) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function copy() {
    let next: "done" | "failed" = "done";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      next = "failed";
    }
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 4000);
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant="secondary" onClick={copy} disabled={disabled} className="self-start">
        {state === "done" ? <Check aria-hidden /> : <Copy aria-hidden />}
        {label}
      </Button>
      <p role="status" aria-live="polite" className={`min-h-5 text-sm ${state === "failed" ? "text-danger" : "text-fg-muted"}`}>
        {state === "done" ? doneText : state === "failed" ? failedText : ""}
      </p>
    </div>
  );
}
