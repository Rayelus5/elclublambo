import { ExternalLink, TriangleAlert } from "lucide-react";
import { needsHomographWarning } from "@/components/chat/out-view";
import { classifyLink, parseExternalUrl } from "@/lib/chat/links";

const LINK_CLASS =
  "inline-flex min-h-11 items-center gap-1 break-all text-accent underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

/**
 * Member-authored links, always through the link guardian: allowed domains open directly, everything else goes
 * through /out. Only https is accepted here (stricter than the guardian), and punycode hosts get a visible warning.
 */
export function ProfileLinks({ links, allowedDomains }: { links: readonly string[]; allowedDomains: readonly string[] }) {
  const items = links.flatMap((raw) => {
    if (!/^https:\/\//i.test(raw)) return [];
    const c = classifyLink(raw, allowedDomains);
    const target = parseExternalUrl(raw);
    if (c.kind === "text" || !target) return [];
    const warn = needsHomographWarning(target.host, target.unicodeHost);
    // A punycode host is always guarded, even under an allowed domain (e.g. xn--....github.io).
    const view = warn ? { kind: "guarded" as const, href: `/out?u=${encodeURIComponent(target.href)}` } : c;
    const label = `${target.host}${target.href.slice(target.href.indexOf(target.host) + target.host.length)}`.replace(/\/$/, "");
    return [{ c: view, label, warn }];
  });
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {items.map(({ c, label, warn }, i) => (
        <li key={i} className="flex flex-col">
          <a href={c.href} target="_blank" rel="noopener noreferrer nofollow ugc" className={LINK_CLASS}>
            {label}
            {c.kind === "guarded" ? <ExternalLink aria-hidden className="size-3.5 shrink-0" /> : null}
            <span className="sr-only">
              {c.kind === "guarded" ? " (sale de El Club, abre en una pestaña nueva)" : " (abre en una pestaña nueva)"}
            </span>
          </a>
          {warn ? (
            <p className="flex items-center gap-1 text-small text-warning">
              <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
              Dominio con caracteres internacionales: puede imitar a otro. Revísalo antes de entrar.
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
