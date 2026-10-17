"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postAlphaAction } from "@/lib/chat/alpha";
import { ALPHA_ADDRESS_RE } from "@/lib/chat/model";
import { rpcErrorMessage } from "@/lib/errors";

export interface AlphaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
  /** Plain text taken from the composer when the dialog opened (editable here). */
  initialText: string;
  onPosted: (id: string) => void;
}

/** Plain text → a minimal Tiptap doc: one paragraph per line. The server sanitizes it again. */
function textToDoc(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd());
  return {
    type: "doc",
    content: lines.map((line) => ({ type: "paragraph", content: line ? [{ type: "text", text: line }] : [] })),
  };
}

function Form({ onOpenChange, channelId, initialText, onPosted }: AlphaDialogProps) {
  const [address, setAddress] = useState("");
  const [thesis, setThesis] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    const clean = address.trim();
    if (!ALPHA_ADDRESS_RE.test(clean)) {
      setError("Introduce una dirección de contrato válida (0x seguido de 40 caracteres hexadecimales).");
      return;
    }
    if (thesis.trim() === "") {
      setError("Escribe tu tesis: por qué merece la pena este contrato.");
      return;
    }
    setSending(true);
    setError(null);
    let res: { id?: string; error?: string };
    try {
      res = await postAlphaAction({ channelId, address: clean, doc: textToDoc(thesis) });
    } catch {
      res = { error: "unknown" };
    }
    setSending(false);
    if (res.error || !res.id) {
      setError(rpcErrorMessage(res.error ?? "unknown"));
      return;
    }
    onPosted(res.id);
    onOpenChange(false);
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="alpha-address">Contrato en Linea</Label>
        <Input
          id="alpha-address"
          value={address}
          onChange={(e) => {
            setAddress(e.target.value);
            setError(null);
          }}
          placeholder="0x…"
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="alpha-thesis">Tu tesis</Label>
        <textarea
          id="alpha-thesis"
          value={thesis}
          onChange={(e) => {
            setThesis(e.target.value);
            setError(null);
          }}
          rows={5}
          maxLength={4000}
          className="w-full min-w-0 rounded-control border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg md:text-sm"
        />
      </div>
      <p className="text-[13px] text-fg-muted">
        Comprobamos en Linea que la dirección es un contrato antes de publicar. Contenido de terceros: nada de esto es consejo financiero.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
        <Button type="submit" disabled={sending}>
          {sending ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Sparkles aria-hidden />}
          Publicar alpha
        </Button>
      </div>
    </form>
  );
}

export function AlphaDialog(props: AlphaDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Publicar alpha</DialogTitle>
          <DialogDescription>Comparte un contrato de Linea con su gráfico y tu tesis.</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open: every opening starts from the composer's current text. */}
        <Form {...props} />
      </DialogContent>
    </Dialog>
  );
}
