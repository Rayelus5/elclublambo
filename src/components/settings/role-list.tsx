"use client";

import { useId, useState, useTransition } from "react";
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
  type ScreenReaderInstructions,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RoleForm, type FormActor } from "@/components/settings/role-form";
import { rpcErrorMessage } from "@/lib/errors";
import { deleteRoleAction, moveRoleAction } from "@/lib/roles/actions";
import { canDragRole, canManageRole, canMoveTo, dropPosition, type RoleItem } from "@/lib/roles/rules";
import { cn } from "@/lib/utils";

const ICON_BUTTON =
  "flex size-11 shrink-0 items-center justify-center rounded-control text-fg-muted transition-colors duration-150 outline-none hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none";

type Props = { roles: RoleItem[]; actor: FormActor };

const INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    "Para reordenar, pulsa espacio. Muévete con las flechas arriba y abajo, pulsa espacio para soltar o escape para cancelar. Los roles de arriba mandan sobre los de abajo.",
};

type RowProps = {
  role: RoleItem;
  draggable: boolean;
  manageable: boolean;
  pending: boolean;
  sortable: boolean;
  onEdit: () => void;
  onDelete: () => void;
};

/** One role. Sortable rows get a grip (drag or keyboard); SuperAdmin and @everyone are pinned rows with a lock. */
function RoleRow({ role, draggable, manageable, pending, sortable, onEdit, onDelete }: RowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: role.id,
    disabled: { draggable: !draggable || pending, droppable: !sortable },
  });
  const fixed = role.isEveryone || role.isSystem;
  return (
    <li
      ref={sortable ? setNodeRef : undefined}
      style={sortable ? { transform: CSS.Translate.toString(transform), transition } : undefined}
      className={cn(
        "flex items-center gap-1 border-b border-border py-1 pr-1 pl-1 last:border-b-0",
        isDragging && "relative z-10 bg-surface-2",
      )}
    >
      {draggable ? (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reordenar ${role.name}`}
          className={cn(ICON_BUTTON, "cursor-grab touch-none active:cursor-grabbing")}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
      ) : (
        <span aria-hidden className="flex size-11 shrink-0 items-center justify-center text-fg-muted/60">
          {fixed ? <Lock className="size-4" /> : null}
        </span>
      )}
      <span aria-hidden className="size-4 shrink-0 rounded-full border border-border-strong" style={{ backgroundColor: role.color }} />
      <div className="flex min-w-0 flex-1 flex-col px-2">
        <span className="truncate text-sm font-bold text-fg">{role.name}</span>
        {role.isEveryone || role.isSystem ? (
          <span className="text-xs text-fg-muted">{role.isEveryone ? "Base de todos · siempre abajo" : "Sistema · siempre arriba"}</span>
        ) : null}
      </div>
      <button type="button" aria-label={`Editar ${role.name}`} disabled={!manageable || pending} onClick={onEdit} className={ICON_BUTTON}>
        <Pencil className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        aria-label={`Borrar ${role.name}`}
        disabled={!manageable || fixed || role.systemKey !== null || pending}
        onClick={onDelete}
        className={cn(ICON_BUTTON, "hover:text-danger")}
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
    </li>
  );
}

export function RoleList({ roles, actor }: Props) {
  const router = useRouter();
  const dndId = useId();
  const sorted = roles.toSorted((a, b) => b.position - a.position);
  // Optimistic order (ids, highest first) while a move is in flight; the server order wins once it refreshes.
  const [optimistic, setOptimistic] = useState<{ base: string; ids: string[] } | null>(null);
  const baseKey = sorted.map((r) => `${r.id}:${r.position}`).join(",");
  const byId = new Map(sorted.map((r) => [r.id, r]));
  const ordered =
    optimistic && optimistic.base === baseKey ? optimistic.ids.map((id) => byId.get(id)).filter((r): r is RoleItem => !!r) : sorted;
  const [editing, setEditing] = useState<RoleItem | "new" | null>(null);
  const [deleting, setDeleting] = useState<RoleItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const nameOf = (id: unknown) => byId.get(String(id))?.name ?? "el rol";
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Has levantado ${nameOf(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${nameOf(active.id)} está sobre ${nameOf(over.id)}.` : `${nameOf(active.id)} no está sobre ningún rol.`),
    onDragEnd: ({ active, over }) => (over ? `Has soltado ${nameOf(active.id)} junto a ${nameOf(over.id)}.` : `Has soltado ${nameOf(active.id)} sin moverlo.`),
    onDragCancel: ({ active }) => `Movimiento cancelado. ${nameOf(active.id)} vuelve a su sitio.`,
  };

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = ordered.map((r) => r.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    const target = ordered[to];
    // SuperAdmin and @everyone stay where they are.
    if (from < 0 || to < 0 || !target || target.isSystem || target.isEveryone) return;
    const next = arrayMove(ids, from, to);
    const position = dropPosition(next.map((id) => byId.get(id)!), String(active.id));
    // A slot at or above the actor's own rank would bounce off move_role: say so without a round trip.
    if (!canMoveTo(position, actor)) {
      setError(rpcErrorMessage("hierarchy"));
      return;
    }
    setError(null);
    setOptimistic({ base: baseKey, ids: next });
    startTransition(async () => {
      const res = await moveRoleAction(String(active.id), position);
      if (res.error) {
        setOptimistic(null);
        setError(rpcErrorMessage(res.error));
        return;
      }
      router.refresh();
    });
  }

  function confirmDelete() {
    const role = deleting;
    if (!role) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteRoleAction(role.id);
      setDeleting(null);
      if (res.error) {
        setError(rpcErrorMessage(res.error));
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button type="button" variant="secondary" onClick={() => setEditing("new")}>
          <Plus aria-hidden />
          Nuevo rol
        </Button>
      </div>

      {error ? (
        <p role="alert" className="rounded-control border border-danger px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      <p className="text-[13px] text-fg-muted">
        Arrastra para ordenar: los roles de arriba mandan sobre los de abajo. SuperAdmin y @everyone no se mueven.
      </p>

      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{ announcements, screenReaderInstructions: INSTRUCTIONS }}
      >
        <SortableContext items={ordered.filter((r) => !r.isSystem && !r.isEveryone).map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col rounded-panel border border-border bg-surface">
            {ordered.map((role) => (
              <RoleRow
                key={role.id}
                role={role}
                sortable={!role.isSystem && !role.isEveryone}
                draggable={canDragRole(role, actor)}
                manageable={canManageRole(role, actor)}
                pending={pending}
                onEdit={() => setEditing(role)}
                onDelete={() => setDeleting(role)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Nuevo rol" : `Editar ${editing?.name ?? ""}`}</DialogTitle>
            <DialogDescription>
              {editing === "new"
                ? "El rol nuevo se coloca justo por debajo de tu rol más alto."
                : "Los cambios se aplican a todos los miembros con este rol."}
            </DialogDescription>
          </DialogHeader>
          {editing ? (
            <RoleForm
              key={editing === "new" ? "new" : editing.id}
              role={editing === "new" ? null : editing}
              actor={actor}
              onDone={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && !pending && setDeleting(null)}>
        <AlertDialogContent className="data-[size=default]:max-w-md data-[size=default]:sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Borrar {deleting?.name}</AlertDialogTitle>
            <AlertDialogDescription>
              Se quita el rol a todos sus miembros y se borran sus permisos en los canales. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
            >
              {pending ? "Borrando…" : "Borrar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
