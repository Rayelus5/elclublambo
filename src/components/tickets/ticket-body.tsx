import { ExternalLink } from "lucide-react";
import { classifyLink } from "@/lib/chat/links";
import { linkifyPlainText } from "@/lib/tickets/model";

const LINK_CLASS =
  "rounded-control text-accent underline underline-offset-2 break-all hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none";

/**
 * Body of a ticket message: plain text with its whitespace kept. Only when the author had EMBED_LINKS (`allowLinks`)
 * are http(s) urls clickable, and then through the link guardian (allowed domains go direct, the rest through /out).
 * React text nodes only: nothing in the body is ever interpreted as markup.
 */
export function TicketBody({
  text,
  allowLinks,
  allowedDomains,
}: {
  text: string;
  allowLinks: boolean;
  allowedDomains: readonly string[];
}) {
  const parts = linkifyPlainText(text, allowLinks);
  return (
    <div className="min-w-0 text-[15px] leading-relaxed break-words whitespace-pre-wrap">
      {parts.map((p, i) => {
        if (p.type === "text") return <span key={i}>{p.value}</span>;
        const c = classifyLink(p.value, allowedDomains);
        if (c.kind === "text") return <span key={i}>{p.value}</span>;
        return (
          <a key={i} href={c.href} target="_blank" rel="noopener noreferrer nofollow ugc" className={LINK_CLASS}>
            {p.value}
            {c.kind === "guarded" ? <ExternalLink aria-hidden className="ml-0.5 inline size-3 align-baseline" /> : null}
            <span className="sr-only">
              {c.kind === "guarded" ? " (sale de El Club, abre en una pestaña nueva)" : " (abre en una pestaña nueva)"}
            </span>
          </a>
        );
      })}
    </div>
  );
}
