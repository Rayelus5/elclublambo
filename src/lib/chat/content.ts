// Tiptap JSON handling for chat messages: allowlist sanitizer, plain-text derivation (mirror of the SQL
// _doc_text) and mention extraction (mirror of the SQL _insert_mentions parsing). Pure and total: nothing
// here throws on malformed input.
import { classifyLink } from "@/lib/chat/links";

export interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: TiptapMark[];
}

export interface TiptapDoc {
  type: "doc";
  content: TiptapNode[];
}

/** Same cutoff as the SQL `_doc_text_rec`: nodes nested deeper than this are ignored. */
export const MAX_DOC_DEPTH = 40;
/** Defensive cap on the number of nodes kept by the sanitizer. */
export const MAX_DOC_NODES = 5000;
export const MAX_MENTIONS = 50;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MARKS = new Set(["bold", "italic", "strike", "code", "link"]);
const INLINE = new Set(["text", "mention", "hardBreak"]);
const BLOCKS = new Set(["paragraph", "heading", "bulletList", "orderedList", "blockquote", "codeBlock", "horizontalRule", "table"]);

type Mode = "blocks" | "inline" | "code" | "listItems" | "rows" | "cells" | "none";
const CHILD_MODE: Record<string, Mode> = {
  doc: "blocks",
  paragraph: "inline",
  heading: "inline",
  bulletList: "listItems",
  orderedList: "listItems",
  listItem: "blocks",
  blockquote: "blocks",
  codeBlock: "code",
  horizontalRule: "none",
  table: "rows",
  tableRow: "cells",
  tableHeader: "blocks",
  tableCell: "blocks",
  hardBreak: "none",
  mention: "none",
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function own(o: unknown, key: string): unknown {
  return isObject(o) && Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined;
}

function intIn(v: unknown, min: number, max: number): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;
}

// --- sanitizer --------------------------------------------------------------------------------------

interface Ctx {
  budget: number;
}

function take(ctx: Ctx): boolean {
  if (ctx.budget <= 0) return false;
  ctx.budget -= 1;
  return true;
}

function sanitizeMarks(raw: unknown): TiptapMark[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: TiptapMark[] = [];
  const seen = new Set<string>();
  for (const m of raw) {
    const type = own(m, "type");
    if (typeof type !== "string" || !MARKS.has(type) || seen.has(type)) continue;
    if (type === "link") {
      const href = own(own(m, "attrs"), "href");
      if (typeof href !== "string" || classifyLink(href, []).kind === "text") continue;
      out.push({ type, attrs: { href } });
    } else {
      out.push({ type });
    }
    seen.add(type);
  }
  return out.length > 0 ? out : undefined;
}

function sanitizeMention(raw: unknown): TiptapNode | null {
  const attrs = own(raw, "attrs");
  const kind = own(attrs, "kind");
  const id = own(attrs, "id");
  const label = own(attrs, "label");
  const out: Record<string, unknown> = {};
  if (kind === "everyone") {
    out.kind = kind;
  } else if ((kind === "member" || kind === "role") && typeof id === "string" && UUID_RE.test(id)) {
    out.kind = kind;
    out.id = id.toLowerCase();
  } else {
    return null;
  }
  // The label is untrusted (kept only so docToPlainText stays consistent with the SQL text); renderers
  // must resolve the name from `id`.
  if (typeof label === "string") out.label = label.slice(0, 100);
  return { type: "mention", attrs: out };
}

function sanitizeAttrs(type: string, raw: unknown): Record<string, unknown> | undefined {
  const a = own(raw, "attrs");
  if (type === "heading") return { level: intIn(own(a, "level"), 1, 3) ?? 2 };
  if (type === "orderedList") {
    const start = intIn(own(a, "start"), 1, 999999);
    return start !== null && start !== 1 ? { start } : undefined;
  }
  if (type === "tableCell" || type === "tableHeader") {
    const out: Record<string, unknown> = {};
    const colspan = intIn(own(a, "colspan"), 1, 20);
    const rowspan = intIn(own(a, "rowspan"), 1, 20);
    if (colspan !== null) out.colspan = colspan;
    if (rowspan !== null) out.rowspan = rowspan;
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return undefined;
}

function collectInline(nodes: TiptapNode[]): TiptapNode[] {
  const out: TiptapNode[] = [];
  nodes.forEach((n, i) => {
    if (INLINE.has(n.type)) {
      out.push(n);
      return;
    }
    if (i > 0 && out.length > 0) out.push({ type: "hardBreak" });
    out.push(...collectInline(n.content ?? []));
  });
  return out;
}

function collectText(nodes: TiptapNode[]): TiptapNode[] {
  const out: TiptapNode[] = [];
  for (const n of nodes) {
    if (n.type === "text") out.push({ type: "text", text: n.text });
    else if (n.type === "hardBreak") out.push({ type: "text", text: "\n" });
    else out.push(...collectText(n.content ?? []));
  }
  return out;
}

function wrap(type: string, content: TiptapNode[], ctx: Ctx): TiptapNode | null {
  if (!take(ctx)) return null;
  return content.length > 0 ? { type, content } : { type };
}

function asBlocks(nodes: TiptapNode[], ctx: Ctx): TiptapNode[] {
  const out: TiptapNode[] = [];
  let run: TiptapNode[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const p = wrap("paragraph", run, ctx);
    if (p) out.push(p);
    run = [];
  };
  for (const n of nodes) {
    if (INLINE.has(n.type)) run.push(n);
    else if (BLOCKS.has(n.type)) {
      flush();
      out.push(n);
    } else {
      // Structural node outside its parent (listItem, tableRow, cell...): keep its content only.
      flush();
      out.push(...asBlocks(n.content ?? [], ctx));
    }
  }
  flush();
  return out;
}

function normalize(nodes: TiptapNode[], mode: Mode, ctx: Ctx): TiptapNode[] {
  switch (mode) {
    case "blocks":
      return asBlocks(nodes, ctx);
    case "inline":
      return collectInline(nodes);
    case "code":
      return collectText(nodes);
    case "listItems": {
      const out: TiptapNode[] = [];
      let loose: TiptapNode[] = [];
      const flush = () => {
        if (loose.length === 0) return;
        const item = wrap("listItem", asBlocks(loose, ctx), ctx);
        if (item) out.push(item);
        loose = [];
      };
      for (const n of nodes) {
        if (n.type === "listItem") {
          flush();
          out.push(n);
        } else loose.push(n);
      }
      flush();
      return out;
    }
    case "rows":
      return nodes.filter((n) => n.type === "tableRow");
    case "cells":
      return nodes.filter((n) => n.type === "tableCell" || n.type === "tableHeader");
    default:
      return [];
  }
}

function convert(raw: unknown, depth: number, ctx: Ctx): TiptapNode[] {
  if (depth > MAX_DOC_DEPTH || ctx.budget <= 0 || !isObject(raw)) return [];
  const type = own(raw, "type");
  if (typeof type !== "string") return [];

  if (type === "text") {
    const text = own(raw, "text");
    if (typeof text !== "string" || text === "" || !take(ctx)) return [];
    const marks = sanitizeMarks(own(raw, "marks"));
    return [marks ? { type, text, marks } : { type, text }];
  }
  if (type === "mention") {
    const m = sanitizeMention(raw);
    return m && take(ctx) ? [m] : [];
  }
  if (type === "hardBreak") return take(ctx) ? [{ type }] : [];

  const mode = Object.prototype.hasOwnProperty.call(CHILD_MODE, type) ? CHILD_MODE[type] : undefined;
  const rawChildren = own(raw, "content");
  const kids: TiptapNode[] = [];
  if (Array.isArray(rawChildren)) {
    for (const c of rawChildren) kids.push(...convert(c, depth + 1, ctx));
  }
  if (mode === undefined || type === "doc") {
    // Unknown (or nested doc) node: drop the node, keep what its children produced.
    return kids;
  }
  if (!take(ctx)) return [];
  const content = normalize(kids, mode, ctx);
  const node: TiptapNode = { type };
  const attrs = sanitizeAttrs(type, raw);
  if (attrs) node.attrs = attrs;
  if (content.length > 0) node.content = content;
  return [node];
}

/** Rebuilds a Tiptap doc keeping only allowlisted nodes, marks and attributes. Never throws. */
export function sanitizeDoc(doc: unknown): TiptapDoc {
  if (!isObject(doc) || own(doc, "type") !== "doc") return { type: "doc", content: [] };
  const ctx: Ctx = { budget: MAX_DOC_NODES };
  const kids: TiptapNode[] = [];
  const rawChildren = own(doc, "content");
  if (Array.isArray(rawChildren)) {
    for (const c of rawChildren) kids.push(...convert(c, 1, ctx));
  }
  return { type: "doc", content: asBlocks(kids, ctx) };
}

// --- plain text (mirror of SQL public._doc_text) ---------------------------------------------------

function textRec(node: unknown, depth: number): string {
  if (depth > MAX_DOC_DEPTH || !isObject(node)) return "";
  const type = node.type;
  if (type === "text") return typeof node.text === "string" ? node.text : "";
  if (type === "mention") {
    const label = own(node.attrs, "label");
    return `@${typeof label === "string" ? label : ""}`;
  }
  if (type === "hardBreak") return "\n";
  if (!Array.isArray(node.content)) return "";
  let out = "";
  // SQL three-valued logic: `(child ->> 'type') in (...)` is NULL when the child is not an object or has no
  // (or a JSON null) `type`; `not v_first and not (NULL and prev)` then adds a newline only when it is TRUE.
  let prevInline: boolean | null = false;
  let first = true;
  for (const child of node.content) {
    const childType = isObject(child) && child.type !== null && child.type !== undefined ? child.type : null;
    const inline: boolean | null =
      childType === null ? null : childType === "text" || childType === "mention" || childType === "hardBreak";
    const both = inline === false || prevInline === false ? false : inline === null || prevInline === null ? null : true;
    if (!first && both === false) out += "\n";
    out += textRec(child, depth + 1);
    prevInline = inline;
    first = false;
  }
  return out;
}

/**
 * Plain text of a Tiptap doc. Must stay identical to the SQL `_doc_text` (see the comment in
 * supabase/migrations/20261016200002_message_rpcs.sql): the server derives the stored text, this mirrors it.
 */
export function docToPlainText(doc: unknown): string {
  return textRec(doc, 0).replace(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g, "");
}

// --- mentions (mirror of the SQL _insert_mentions parsing) ------------------------------------------

export interface MentionRef {
  kind: "member" | "role" | "everyone";
  id: string | null;
}

/** Valid, deduplicated mentions of a doc in document order (max 50), like the server stores them. */
export function extractMentions(doc: unknown): MentionRef[] {
  const out: MentionRef[] = [];
  const seen = new Set<string>();
  const stack: unknown[] = [doc];
  while (stack.length > 0 && out.length < MAX_MENTIONS) {
    const v = stack.pop();
    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) stack.push(v[i]);
      continue;
    }
    if (!isObject(v)) continue;
    if (v.type === "mention") {
      const kind = own(v.attrs, "kind");
      const id = own(v.attrs, "id");
      let ref: MentionRef | null = null;
      if (kind === "everyone") ref = { kind, id: null };
      else if ((kind === "member" || kind === "role") && typeof id === "string" && UUID_RE.test(id)) {
        ref = { kind, id: id.toLowerCase() };
      }
      if (ref) {
        const key = `${ref.kind}:${ref.id ?? ""}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(ref);
        }
      }
    }
    const values = Object.values(v);
    for (let i = values.length - 1; i >= 0; i--) stack.push(values[i]);
  }
  return out;
}
