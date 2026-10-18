import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { sanitizeDoc, type TiptapMark, type TiptapNode } from "@/lib/chat/content";
import { classifyLink } from "@/lib/chat/links";
import { mentionLabel, type MemberIdentity } from "@/lib/members/name";

export interface MentionsDir {
  members: Record<string, MemberIdentity>;
  roles: Record<string, { name: string; color: string }>;
}

interface Props {
  /** Raw Tiptap JSON as stored (untrusted): it is sanitized here before rendering. */
  doc: unknown;
  /** The author held EMBED_LINKS when posting/editing (`messages.allow_links`). */
  allowLinks: boolean;
  /** Rows of `allowed_domains`. */
  allowedDomains: readonly string[];
  mentionsDir: MentionsDir;
}

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const LINK_CLASS =
  "rounded-control text-accent underline underline-offset-2 hover:text-accent/85 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none";

function has(map: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, key);
}

function Mention({ node, dir }: { node: TiptapNode; dir: MentionsDir }) {
  // Never trust attrs.label: the visible name always comes from the id.
  const kind = node.attrs?.kind;
  const id = typeof node.attrs?.id === "string" ? node.attrs.id : "";
  let name = "@desconocido";
  let color: string | null = null;
  if (kind === "everyone") name = "@everyone";
  else if (kind === "member" && has(dir.members, id)) {
    const member = dir.members[id];
    name = member ? mentionLabel(member) : "@desconocido";
  } else if (kind === "role" && has(dir.roles, id)) {
    const role = dir.roles[id];
    name = `@${role?.name ?? "desconocido"}`;
    color = role && HEX_COLOR.test(role.color) ? role.color : null;
  }
  return (
    <span
      data-mention={String(kind)}
      className="inline-flex items-center gap-1 rounded-control border border-border-strong bg-surface-2 px-1.5 align-baseline text-[0.95em] font-medium text-fg"
      style={color ? { borderColor: color } : undefined}
    >
      {color ? <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} /> : null}
      <span>{name}</span>
    </span>
  );
}

function renderText(node: TiptapNode, props: Props): ReactNode {
  let out: ReactNode = node.text ?? "";
  const marks: TiptapMark[] = node.marks ?? [];
  const has_ = (t: string) => marks.some((m) => m.type === t);
  if (has_("code")) {
    out = <code className="rounded-control bg-surface-2 px-1 py-0.5 font-mono text-[0.9em]">{out}</code>;
  }
  if (has_("bold")) out = <strong className="font-bold">{out}</strong>;
  if (has_("italic")) out = <em>{out}</em>;
  if (has_("strike")) out = <s>{out}</s>;
  const link = marks.find((m) => m.type === "link");
  if (link && props.allowLinks) {
    const c = classifyLink(link.attrs?.href, props.allowedDomains);
    if (c.kind !== "text") {
      out = (
        <a
          href={c.href}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          className={`${LINK_CLASS} break-all`}
        >
          {out}
          {c.kind === "guarded" ? <ExternalLink aria-hidden className="ml-0.5 inline size-3 align-baseline" /> : null}
          <span className="sr-only">
            {c.kind === "guarded" ? " (sale de El Club, abre en una pestaña nueva)" : " (abre en una pestaña nueva)"}
          </span>
        </a>
      );
    }
  }
  return out;
}

function renderNodes(nodes: TiptapNode[] | undefined, props: Props): ReactNode {
  return (nodes ?? []).map((n, i) => <Node key={i} node={n} props={props} />);
}

function Node({ node, props }: { node: TiptapNode; props: Props }): ReactNode {
  const kids = () => renderNodes(node.content, props);
  switch (node.type) {
    case "text":
      return renderText(node, props);
    case "hardBreak":
      return <br />;
    case "mention":
      return <Mention node={node} dir={props.mentionsDir} />;
    case "paragraph":
      return <p className="whitespace-pre-wrap">{kids()}</p>;
    case "heading": {
      const level = node.attrs?.level;
      if (level === 1) return <h3 className="font-display text-lg font-bold">{kids()}</h3>;
      if (level === 3) return <h5 className="font-display text-sm font-bold">{kids()}</h5>;
      return <h4 className="font-display text-base font-bold">{kids()}</h4>;
    }
    case "bulletList":
      return <ul className="list-disc space-y-1 pl-5">{kids()}</ul>;
    case "orderedList": {
      const start = typeof node.attrs?.start === "number" ? node.attrs.start : undefined;
      return (
        <ol start={start} className="list-decimal space-y-1 pl-5">
          {kids()}
        </ol>
      );
    }
    case "listItem":
      return <li className="space-y-1">{kids()}</li>;
    case "blockquote":
      return <blockquote className="space-y-2 border-l-2 border-border-strong pl-3 text-fg-muted">{kids()}</blockquote>;
    case "codeBlock":
      return (
        <pre className="overflow-x-auto rounded-control border border-border bg-surface-2 p-3 font-mono text-[13px] leading-relaxed">
          <code>{(node.content ?? []).map((c) => c.text ?? "").join("")}</code>
        </pre>
      );
    case "horizontalRule":
      return <hr className="border-border" />;
    case "table":
      return (
        <div className="max-w-full overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <tbody>{kids()}</tbody>
          </table>
        </div>
      );
    case "tableRow":
      return <tr>{kids()}</tr>;
    case "tableHeader":
      return (
        <th
          colSpan={typeof node.attrs?.colspan === "number" ? node.attrs.colspan : undefined}
          rowSpan={typeof node.attrs?.rowspan === "number" ? node.attrs.rowspan : undefined}
          className="border border-border bg-surface-2 px-2 py-1 text-left font-bold"
        >
          {kids()}
        </th>
      );
    case "tableCell":
      return (
        <td
          colSpan={typeof node.attrs?.colspan === "number" ? node.attrs.colspan : undefined}
          rowSpan={typeof node.attrs?.rowspan === "number" ? node.attrs.rowspan : undefined}
          className="border border-border px-2 py-1 align-top"
        >
          {kids()}
        </td>
      );
    default:
      return null;
  }
}

/**
 * Renders a stored chat message. The doc is sanitized again here (defense in depth against rows written
 * outside the RPCs) and rendered with React elements only.
 */
export function MessageContent(props: Props) {
  const doc = sanitizeDoc(props.doc);
  return <div className="min-w-0 space-y-2 text-[15px] leading-relaxed break-words">{renderNodes(doc.content, props)}</div>;
}
