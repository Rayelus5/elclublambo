"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type ScreenReaderInstructions,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FolderInput, GripVertical, Hash, Layers, MessagesSquare, Plus } from "lucide-react";
import { ChannelForm } from "@/components/settings/channel-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createChannelAction, moveChannelAction } from "@/lib/channels/actions";
import {
  buildTree,
  MAX_DEPTH,
  validParents,
  type ChannelDetailRow,
  type ChannelKind,
  type TreeNode,
} from "@/lib/channels/tree";
import { rpcErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";
const SELECT_CLASS =
  "min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 text-sm text-fg outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50";
const ICON_BUTTON =
  "flex size-11 shrink-0 items-center justify-center rounded-control text-fg-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg motion-reduce:transition-none";
const ROOT = "root";

const KIND_LABEL: Record<ChannelKind, string> = { category: "Categoría", forum: "Foro", text: "Texto" };
const KIND_ICON = { category: Layers, forum: MessagesSquare, text: Hash } as const;

const INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    "Para reordenar, pulsa espacio. Muévete con las flechas arriba y abajo, pulsa espacio para soltar o escape para cancelar. Solo puedes reordenar entre hermanos; para cambiar de padre usa Mover a…",
};

type EditorCtx = {
  activeParent: string | null | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: (node: TreeNode) => void;
  onMove: (node: TreeNode) => void;
};

function SortableNode({ node, depth, ctx }: { node: TreeNode; depth: number; ctx: EditorCtx }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: node.id,
    data: { parentId: node.parentId },
    // Mientras se arrastra, solo los hermanos del nodo activo son destinos válidos.
    disabled: { droppable: ctx.activeParent !== undefined && node.parentId !== ctx.activeParent },
  });
  const Icon = KIND_ICON[node.kind];
  const selected = ctx.selectedId === node.id;
  const canHaveChildren = node.kind !== "text" && depth < MAX_DEPTH;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("flex flex-col", isDragging && "relative z-10 bg-surface-2")}
    >
      <div
        className={cn(
          "flex items-center border-l-2 pr-1",
          selected ? "border-accent bg-surface-2" : "border-transparent",
        )}
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reordenar ${node.name}`}
          className={cn(ICON_BUTTON, "cursor-grab touch-none active:cursor-grabbing", FOCUS)}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={`Editar ${node.name}`}
          aria-pressed={selected}
          onClick={() => ctx.onSelect(node.id)}
          className={cn(
            "flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-control px-2 text-left text-sm font-medium transition-colors duration-150 hover:text-fg motion-reduce:transition-none",
            selected ? "text-fg" : "text-fg-muted",
            FOCUS,
          )}
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{node.name}</span>
          <span className="sr-only"> ({KIND_LABEL[node.kind]})</span>
        </button>
        {canHaveChildren ? (
          <button
            type="button"
            aria-label={`Nuevo en ${node.name}`}
            onClick={() => ctx.onNew(node)}
            className={cn(ICON_BUTTON, FOCUS)}
          >
            <Plus className="size-4" aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={`Mover ${node.name} a…`}
          onClick={() => ctx.onMove(node)}
          className={cn(ICON_BUTTON, FOCUS)}
        >
          <FolderInput className="size-4" aria-hidden />
        </button>
      </div>
      {node.children.length > 0 ? <Branch nodes={node.children} depth={depth + 1} ctx={ctx} /> : null}
    </li>
  );
}

function Branch({ nodes, depth, ctx }: { nodes: TreeNode[]; depth: number; ctx: EditorCtx }) {
  return (
    <SortableContext items={nodes.map((n) => n.id)} strategy={verticalListSortingStrategy}>
      <ul className="flex flex-col">
        {nodes.map((n) => (
          <SortableNode key={n.id} node={n} depth={depth} ctx={ctx} />
        ))}
      </ul>
    </SortableContext>
  );
}

function MoveDialog({
  node,
  tree,
  onClose,
  onDone,
}: {
  node: TreeNode | null;
  tree: TreeNode[];
  onClose: () => void;
  onDone: () => void;
}) {
  const uid = useId();
  const options = useMemo(() => (node ? validParents(tree, node) : []), [node, tree]);
  const [choice, setChoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!node) return null;
  const toValue = (id: string | null) => id ?? ROOT;
  const current = toValue(node.parentId);
  const value =
    choice !== null && options.some((o) => toValue(o.id) === choice)
      ? choice
      : options.some((o) => toValue(o.id) === current)
        ? current
        : options[0]
          ? toValue(options[0].id)
          : "";

  function submit() {
    if (!node || value === "") return;
    setError(null);
    startTransition(async () => {
      const res = await moveChannelAction({ id: node.id, parentId: value === ROOT ? null : value, index: null });
      if (res.error) {
        setError(rpcErrorMessage(res.error));
        return;
      }
      onDone();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mover {node.name}</DialogTitle>
          <DialogDescription>
            Elige el nuevo padre. Se colocará al final. Para cambiar el orden entre hermanos, arrastra o usa el
            teclado.
          </DialogDescription>
        </DialogHeader>
        {options.length === 0 ? (
          <p className="text-sm text-fg-muted">No hay ningún otro destino válido para este canal.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${uid}-parent`}>Nuevo padre</Label>
            <select
              id={`${uid}-parent`}
              value={value}
              onChange={(e) => setChoice(e.target.value)}
              disabled={pending}
              className={SELECT_CLASS}
            >
              {options.map((o) => (
                <option key={toValue(o.id)} value={toValue(o.id)}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {error ? (
          <p role="alert" className="rounded-control border border-danger px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button type="button" onClick={submit} disabled={pending || options.length === 0}>
            {pending ? "Moviendo…" : "Mover"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type CreateTarget = { parent: TreeNode | null };

function CreateDialog({
  target,
  onClose,
  onDone,
}: {
  target: CreateTarget | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const uid = useId();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ChannelKind>("text");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!target) return null;
  const parent = target.parent;
  const effectiveKind: ChannelKind = parent ? kind : "category";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createChannelAction({
        parentId: parent?.id ?? null,
        kind: effectiveKind,
        name,
        topic: "",
      });
      if (res.error) {
        setError(rpcErrorMessage(res.error));
        return;
      }
      setName("");
      onDone();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{parent ? `Nuevo en ${parent.name}` : "Nueva categoría"}</DialogTitle>
            <DialogDescription>
              {parent
                ? "Crea un foro (puede contener más canales) o un canal de texto."
                : "Las categorías agrupan foros y canales en la raíz del árbol."}
            </DialogDescription>
          </DialogHeader>
          {parent ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${uid}-kind`}>Tipo</Label>
              <select
                id={`${uid}-kind`}
                value={kind}
                onChange={(e) => setKind(e.target.value as ChannelKind)}
                disabled={pending}
                className={SELECT_CLASS}
              >
                <option value="text">Canal de texto</option>
                <option value="forum">Foro</option>
              </select>
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${uid}-name`}>Nombre</Label>
            <Input
              id={`${uid}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              required
              disabled={pending}
              autoFocus
            />
          </div>
          {error ? (
            <p role="alert" className="rounded-control border border-danger px-3 py-2 text-[13px] text-danger">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creando…" : "Crear"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ChannelTreeEditor({ channels }: { channels: ChannelDetailRow[] }) {
  const router = useRouter();
  const tree = useMemo(() => buildTree(channels), [channels]);
  const byId = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moving, setMoving] = useState<TreeNode | null>(null);
  const [creating, setCreating] = useState<CreateTarget | null>(null);
  const [activeParent, setActiveParent] = useState<string | null | undefined>(undefined);
  const [dragError, setDragError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const name = (id: unknown) => byId.get(String(id))?.name ?? "el canal";
  const siblingsOf = (parentId: string | null) =>
    channels.filter((c) => c.parentId === parentId).toSorted((a, b) => a.position - b.position);

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Has levantado ${name(active.id)}.`,
    onDragOver: ({ active, over }) => {
      if (!over) return `${name(active.id)} ya no está sobre ningún destino.`;
      const idx = siblingsOf(byId.get(String(over.id))?.parentId ?? null).findIndex((c) => c.id === over.id);
      return `${name(active.id)} está sobre ${name(over.id)}, posición ${idx + 1}.`;
    },
    onDragEnd: ({ active, over }) =>
      over ? `Has soltado ${name(active.id)} sobre ${name(over.id)}.` : `Has soltado ${name(active.id)} sin moverlo.`,
    onDragCancel: ({ active }) => `Movimiento cancelado. ${name(active.id)} vuelve a su sitio.`,
  };

  function onDragStart(e: DragStartEvent) {
    setDragError(null);
    setActiveParent(byId.get(String(e.active.id))?.parentId ?? null);
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveParent(undefined);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const node = byId.get(String(active.id));
    const target = byId.get(String(over.id));
    if (!node || !target || node.parentId !== target.parentId) return;
    const index = siblingsOf(node.parentId).findIndex((c) => c.id === target.id);
    if (index < 0) return;
    startTransition(async () => {
      const res = await moveChannelAction({ id: node.id, parentId: node.parentId, index });
      if (res.error) {
        setDragError(rpcErrorMessage(res.error));
        return;
      }
      router.refresh();
    });
  }

  const ctx: EditorCtx = {
    activeParent,
    selectedId,
    onSelect: setSelectedId,
    onNew: (node) => setCreating({ parent: node }),
    onMove: setMoving,
  };

  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <section aria-labelledby="arbol-titulo" className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="arbol-titulo" className="text-h2">
            Estructura
          </h3>
          <Button type="button" variant="secondary" onClick={() => setCreating({ parent: null })}>
            <Plus aria-hidden />
            Nueva categoría
          </Button>
        </div>

        {dragError ? (
          <p role="alert" className="rounded-control border border-danger px-3 py-2 text-[13px] text-danger">
            {dragError}
          </p>
        ) : null}

        {tree.length === 0 ? (
          <p className="rounded-panel border border-dashed border-border-strong p-6 text-fg-muted">
            Aún no hay canales. Crea una categoría para empezar.
          </p>
        ) : (
          <div className="rounded-panel border border-border bg-surface py-2">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragCancel={() => setActiveParent(undefined)}
              accessibility={{ announcements, screenReaderInstructions: INSTRUCTIONS }}
            >
              <Branch nodes={tree} depth={0} ctx={ctx} />
            </DndContext>
          </div>
        )}
      </section>

      <section aria-labelledby="ajustes-titulo" className="min-w-0">
        <h3 id="ajustes-titulo" className="text-h2">
          {selected ? selected.name : "Ajustes del canal"}
        </h3>
        {selected ? (
          <div className="mt-4 rounded-panel border border-border bg-surface p-4">
            <ChannelForm
              key={selected.id}
              channel={selected}
              onDone={(r) => {
                if (r === "deleted") setSelectedId(null);
              }}
            />
          </div>
        ) : (
          <p className="mt-4 text-sm text-fg-muted">Selecciona un canal del árbol para editar sus ajustes.</p>
        )}
      </section>

      <MoveDialog
        key={moving?.id ?? "none"}
        node={moving}
        tree={tree}
        onClose={() => setMoving(null)}
        onDone={() => {
          setMoving(null);
          router.refresh();
        }}
      />
      <CreateDialog
        key={creating ? (creating.parent?.id ?? "root") : "none"}
        target={creating}
        onClose={() => setCreating(null)}
        onDone={() => {
          setCreating(null);
          router.refresh();
        }}
      />
    </div>
  );
}
