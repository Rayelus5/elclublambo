"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, ChevronDown, ChevronRight, Hash } from "lucide-react";
import { findPath, type TreeNode } from "@/lib/channels/tree";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "elclub:collapsed";
const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

// Almacén externo mínimo sobre localStorage (con respaldo en memoria si no está disponible).
const listeners = new Set<() => void>();
let memoryFallback = "[]";

function getSnapshot(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "[]";
  } catch {
    return memoryFallback;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function writeCollapsed(ids: string[]) {
  const value = JSON.stringify(ids);
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    memoryFallback = value;
  }
  listeners.forEach((l) => l());
}

function parseCollapsed(raw: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

const indent = (depth: number) => ({ paddingLeft: `${16 + depth * 12}px` });

function activeIdFrom(pathname: string): string | null {
  const match = /^\/c\/([^/]+)/.exec(pathname);
  return match?.[1] ?? null;
}

function ChannelLink({ node, depth, active }: { node: TreeNode; depth: number; active: boolean }) {
  return (
    <Link
      href={`/c/${node.id}`}
      aria-current={active ? "page" : undefined}
      style={indent(depth)}
      className={cn(
        "flex min-h-11 items-center gap-2 border-l-2 pr-4 text-sm font-medium transition-colors duration-150 ease-out hover:bg-surface-2 motion-reduce:transition-none",
        FOCUS,
        active ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
      )}
    >
      <Hash className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{node.name}</span>
    </Link>
  );
}

type TreeState = {
  activeId: string | null;
  collapsed: Set<string>;
  openForums: Set<string>;
  toggleCategory: (id: string) => void;
  toggleForum: (id: string) => void;
};

function Branch({ nodes, depth, state }: { nodes: TreeNode[]; depth: number; state: TreeState }) {
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === "text") {
          return <ChannelLink key={node.id} node={node} depth={depth} active={state.activeId === node.id} />;
        }
        if (node.kind === "category") {
          const expanded = !state.collapsed.has(node.id);
          return (
            <div key={node.id} className="flex flex-col">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => state.toggleCategory(node.id)}
                style={indent(depth)}
                className={cn(
                  "flex min-h-11 w-full items-center gap-1.5 pr-4 text-left text-[13px] font-semibold tracking-wide text-fg-muted uppercase transition-colors duration-150 hover:text-fg motion-reduce:transition-none",
                  FOCUS,
                )}
              >
                {expanded ? (
                  <ChevronDown className="size-4 shrink-0" aria-hidden />
                ) : (
                  <ChevronRight className="size-4 shrink-0" aria-hidden />
                )}
                <span className="min-w-0 truncate">{node.name}</span>
              </button>
              {expanded ? <Branch nodes={node.children} depth={depth + 1} state={state} /> : null}
            </div>
          );
        }
        const expanded = state.openForums.has(node.id);
        const forumActive = state.activeId === node.id;
        return (
          <div key={node.id} className="flex flex-col">
            <div className="flex items-stretch">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => state.toggleForum(node.id)}
                style={indent(depth)}
                className={cn(
                  "flex min-h-11 min-w-0 flex-1 items-center gap-2 border-l-2 pr-2 text-left text-sm font-medium transition-colors duration-150 hover:bg-surface-2 hover:text-fg motion-reduce:transition-none",
                  FOCUS,
                  forumActive ? "border-accent text-fg" : "border-transparent text-fg-muted",
                )}
              >
                {expanded ? (
                  <ChevronDown className="size-4 shrink-0" aria-hidden />
                ) : (
                  <ChevronRight className="size-4 shrink-0" aria-hidden />
                )}
                <span className="min-w-0 truncate">{node.name}</span>
              </button>
              <Link
                href={`/c/${node.id}`}
                aria-label={`Abrir ${node.name}`}
                aria-current={forumActive ? "page" : undefined}
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center text-fg-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg motion-reduce:transition-none",
                  FOCUS,
                )}
              >
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
            {expanded ? <Branch nodes={node.children} depth={depth + 1} state={state} /> : null}
          </div>
        );
      })}
    </>
  );
}

/** Árbol de canales de la barra lateral. Las categorías recuerdan su estado en localStorage. */
export function ChannelTree({ nodes }: { nodes: TreeNode[] }) {
  const pathname = usePathname();
  const activeId = activeIdFrom(pathname);

  const ancestors = activeId ? findPath(nodes, activeId).slice(0, -1) : [];
  const ancestorKey = ancestors.map((n) => n.id).join("/");

  // Leer lo guardado sin desajuste de hidratación: el servidor renderiza todo expandido.
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => "[]");
  const stored = parseCollapsed(raw);

  // Al navegar, los ancestros del canal activo se muestran abiertos aunque estén guardados como colapsados.
  const [openForums, setOpenForums] = useState<Set<string>>(
    () => new Set(ancestors.filter((n) => n.kind === "forum").map((n) => n.id)),
  );
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set(ancestors.map((n) => n.id)));
  const [seenKey, setSeenKey] = useState(ancestorKey);
  if (seenKey !== ancestorKey) {
    setSeenKey(ancestorKey);
    setRevealed(new Set(ancestors.map((n) => n.id)));
    setOpenForums((prev) => new Set([...prev, ...ancestors.filter((n) => n.kind === "forum").map((n) => n.id)]));
  }

  const collapsed = new Set([...stored].filter((id) => !revealed.has(id)));

  const toggleCategory = (id: string) => {
    const next = new Set(collapsed);
    if (!next.delete(id)) next.add(id);
    setRevealed((prev) => new Set([...prev].filter((r) => r !== id)));
    writeCollapsed([...next]);
  };

  const toggleForum = (id: string) => {
    const next = new Set(openForums);
    if (!next.delete(id)) next.add(id);
    setOpenForums(next);
  };

  return (
    <div className="flex flex-col">
      <Branch nodes={nodes} depth={0} state={{ activeId, collapsed, openForums, toggleCategory, toggleForum }} />
    </div>
  );
}
