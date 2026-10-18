import { Coins, ExternalLink } from "lucide-react";
import type { ChatMessage } from "@/lib/chat/model";
import { explorerTx } from "@/lib/economy/networks";

/** Plain text of a Tiptap-like doc. Notices are written by the server, but the JSON is still treated as untrusted. */
export function noticeText(doc: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown, depth: number) => {
    if (depth > 8 || typeof node !== "object" || node === null) return;
    const n = node as { text?: unknown; content?: unknown };
    if (typeof n.text === "string") parts.push(n.text);
    if (Array.isArray(n.content)) for (const c of n.content) walk(c, depth + 1);
  };
  walk(doc, 0);
  return parts.join("").trim();
}

const TIME = new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" });
const FULL = new Intl.DateTimeFormat("es", { dateStyle: "full", timeStyle: "short" });

/**
 * A compact row for "X ha enviado N TOKEN a Y por este mensaje". It has no author: the label is always "El Club".
 * The wrapper (the list item) belongs to MessageItem.
 */
export function SystemNotice({ message }: { message: Pick<ChatMessage, "body" | "createdAt" | "tipLink"> }) {
  const d = new Date(message.createdAt);
  const valid = !Number.isNaN(d.getTime());
  return (
    <div className="flex min-w-0 flex-1 items-start gap-3 py-1">
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center text-accent">
        <Coins className="size-5" />
      </span>
      <p className="min-w-0 flex-1 text-sm break-words text-fg-muted">
        <span className="font-display font-bold text-fg">El Club</span>
        {valid ? (
          <>
            {" "}
            <time dateTime={message.createdAt} title={FULL.format(d)} suppressHydrationWarning className="text-[13px]">
              {TIME.format(d)}
            </time>
          </>
        ) : null}
        <br />
        <span>{noticeText(message.body)}</span>
        {message.tipLink ? (
          <>
            {" "}
            <a
              href={explorerTx(message.tipLink.chainId, message.tipLink.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1 rounded-control text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
            >
              Ver transacción
              <ExternalLink aria-hidden className="size-3.5" />
              <span className="sr-only"> (se abre en una pestaña nueva)</span>
            </a>
          </>
        ) : null}
      </p>
    </div>
  );
}
