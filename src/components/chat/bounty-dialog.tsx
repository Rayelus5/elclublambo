"use client";

import { useState } from "react";
import { Loader2, Trophy } from "lucide-react";
import { NetworkBadge } from "@/components/economy/network-badge";
import { HowItWorksLink } from "@/components/guide/how-it-works-link";
import { useEconomy } from "@/components/payments/economy-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createBountyAction } from "@/lib/bounties/actions";
import { BOUNTY_LIMITS } from "@/lib/bounties/limits";
import { rpcErrorMessage } from "@/lib/errors";
import { formatAmount, parseAmount, type Token } from "@/lib/payments/amounts";
import { cn } from "@/lib/utils";

export interface BountyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
  /** Plain text taken from the composer when the dialog opened (editable here). */
  initialText: string;
  onPosted: (id: string) => void;
}

const TOKENS: Token[] = ["USDC", "ETH"];
type Field = "amount" | "description" | null;
const ERROR_ID = "bounty-error";
const RANGE_ID = "bounty-range";

/** Plain text → a minimal Tiptap doc: one paragraph per line. The server sanitizes it again. */
function textToDoc(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd());
  return {
    type: "doc",
    content: lines.map((line) => ({ type: "paragraph", content: line ? [{ type: "text", text: line }] : [] })),
  };
}

function Form({ onOpenChange, channelId, initialText, onPosted }: BountyDialogProps) {
  const { activeChainId } = useEconomy();
  const [token, setToken] = useState<Token>("USDC");
  const [amountText, setAmountText] = useState("");
  const [description, setDescription] = useState(initialText);
  const [error, setError] = useState<{ text: string; field: Field } | null>(null);
  const [sending, setSending] = useState(false);

  const limits = BOUNTY_LIMITS[token];
  const units = parseAmount(amountText, token);
  const typed = amountText.trim() !== "";
  const rangeError =
    typed && (units === null || units < limits.min || units > limits.max)
      ? `La recompensa debe estar entre ${formatAmount(limits.min, token)} y ${formatAmount(limits.max, token)} ${token}.`
      : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    if (!typed) {
      setError({ text: "Introduce el importe de la recompensa.", field: "amount" });
      return;
    }
    if (rangeError) {
      setError({ text: rangeError, field: "amount" });
      return;
    }
    if (description.trim() === "") {
      setError({ text: "Escribe la descripción: qué necesitas y cómo reconocerás una buena solución.", field: "description" });
      return;
    }
    setSending(true);
    setError(null);
    let res: Awaited<ReturnType<typeof createBountyAction>>;
    try {
      res = await createBountyAction({ channelId, body: textToDoc(description), token, amount: amountText.trim() });
    } catch {
      res = { ok: false, code: "unknown", error: rpcErrorMessage("unknown") };
    }
    setSending(false);
    if (!res.ok) {
      setError({ text: res.error, field: res.code === "amount_out_of_range" ? "amount" : null });
      return;
    }
    onPosted(res.messageId);
    onOpenChange(false);
  };

  const invalid = (field: Field) => (error && error.field === field ? { "aria-invalid": true as const } : {});

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
      <NetworkBadge chainId={activeChainId} className="self-start" />

      <div role="radiogroup" aria-label="Moneda" className="grid grid-cols-2 gap-1 rounded-control border border-border-strong p-1">
        {TOKENS.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={token === t}
            onClick={() => {
              setToken(t);
              setError(null);
            }}
            className={cn(
              "min-h-11 rounded-control text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-accent",
              token === t ? "bg-accent text-bg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="bounty-amount">Recompensa</Label>
        <div className="flex items-center gap-2">
          <Input
            id="bounty-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            value={amountText}
            onChange={(e) => {
              setAmountText(e.target.value);
              setError(null);
            }}
            aria-invalid={rangeError || (error && error.field === "amount") ? true : undefined}
            aria-describedby={rangeError ? RANGE_ID : undefined}
            className="font-mono"
          />
          <span className="font-mono text-sm text-fg-muted">{token}</span>
        </div>
        {rangeError ? (
          <p id={RANGE_ID} aria-live="polite" className="text-[13px] text-danger">
            {rangeError}
          </p>
        ) : (
          <p className="text-[13px] text-fg-muted">
            Entre {formatAmount(limits.min, token)} y {formatAmount(limits.max, token)} {token}. Se paga a la solución que elijas, con la comisión aparte.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="bounty-description">Descripción</Label>
        <textarea
          id="bounty-description"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setError(null);
          }}
          required
          aria-required="true"
          {...invalid("description")}
          rows={5}
          maxLength={4000}
          className="w-full min-w-0 rounded-control border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg aria-invalid:border-danger md:text-sm"
        />
        <p className="text-[13px] text-fg-muted">Texto plano. Las soluciones llegan como respuestas en el hilo del bounty.</p>
      </div>

      {error ? (
        <p id={ERROR_ID} role="alert" className="text-sm text-danger">
          {error.text}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <HowItWorksLink section="bounties" />
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" disabled={sending}>
            {sending ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Trophy aria-hidden />}
            Publicar bounty
          </Button>
        </div>
      </div>
    </form>
  );
}

export function BountyDialog(props: BountyDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Publicar bounty</DialogTitle>
          <DialogDescription>Ofrece una recompensa por una solución. Tú eliges la respuesta y la pagas.</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open: every opening starts from the composer's current text. */}
        <Form {...props} />
      </DialogContent>
    </Dialog>
  );
}
