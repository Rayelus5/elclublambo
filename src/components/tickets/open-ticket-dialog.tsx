"use client";

import { clubPath } from "@/lib/club/paths";
import { useEffect, useId, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { rpcErrorMessage } from "@/lib/errors";
import { openTicketAction } from "@/lib/tickets/actions";
import { BODY_MAX, SUBJECT_MAX, SUBJECT_MIN, validateBody, validateSubject } from "@/lib/tickets/model";
import { cn } from "@/lib/utils";

/** "Abrir ticket" button of a channel header with the form in a dialog. On success it opens the new ticket. */
export function OpenTicketDialog({ channelId, channelName }: { channelId: string; channelName: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // `?openTicket=1` (the palette's "Abrir ticket en #canal" action) opens the form once. The channel page only
  // renders this component when tickets are enabled and the member can post, so the param cannot bypass that.
  const wantsOpen = searchParams.get("openTicket") === "1";
  useEffect(() => {
    if (!wantsOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to a URL request, then consuming it
    setOpen(true);
    const rest = new URLSearchParams(searchParams.toString());
    rest.delete("openTicket");
    const qs = rest.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }, [wantsOpen, searchParams, pathname]);

  const change = (next: boolean) => {
    if (pending) return;
    setOpen(next);
    if (!next) {
      setSubject("");
      setBody("");
      setError(null);
    }
  };

  const submit = () => {
    const s = validateSubject(subject);
    if (!s.ok) {
      setError(`El asunto debe tener entre ${SUBJECT_MIN} y ${SUBJECT_MAX} caracteres.`);
      return;
    }
    const b = validateBody(body);
    if (!b.ok) {
      setError(`Escribe tu mensaje (hasta ${BODY_MAX} caracteres).`);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await openTicketAction(channelId, s.value, b.value).catch(() => ({ error: "unknown" }) as { id?: string; error?: string });
      // Nested transition so the result commits together with pending=false.
      startTransition(() => {
        if (res.error || !res.id) {
          setError(rpcErrorMessage(res.error ?? "unknown"));
          return;
        }
        setOpen(false);
        router.push(clubPath(`/tickets/${res.id}`));
      });
    });
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" className="w-fit">
          <LifeBuoy aria-hidden />
          Abrir ticket
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-bold">Abrir un ticket</DialogTitle>
          <DialogDescription>
            Solo lo verás tú y el equipo de soporte de #{channelName}. Te avisaremos cuando respondan.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${uid}-subject`}>Asunto</Label>
            <Input
              id={`${uid}-subject`}
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                setError(null);
              }}
              maxLength={SUBJECT_MAX + 20}
              disabled={pending}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${uid}-body`}>Mensaje</Label>
            <textarea
              id={`${uid}-body`}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setError(null);
              }}
              rows={5}
              disabled={pending}
              aria-describedby={`${uid}-count`}
              className="min-h-28 w-full resize-y rounded-control border border-border-strong bg-surface px-3 py-2 text-[15px] text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
            />
            <p id={`${uid}-count`} className={cn("text-right font-mono text-[13px]", body.length > BODY_MAX ? "text-danger" : "text-fg-muted")}>
              {body.length}/{BODY_MAX}
            </p>
          </div>
          {error ? (
            <p role="alert" className="rounded-control border border-danger px-3 py-2 text-[13px] text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" disabled={pending} onClick={() => change(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Enviando…" : "Enviar ticket"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
