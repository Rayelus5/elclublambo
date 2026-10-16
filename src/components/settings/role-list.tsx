"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
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
import { canManageRole, canMoveTo, type RoleItem } from "@/lib/roles/rules";
import { cn } from "@/lib/utils";

const ICON_BUTTON =
  "flex size-11 shrink-0 items-center justify-center rounded-control text-fg-muted transition-colors duration-150 outline-none hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none";

type Props = { roles: RoleItem[]; actor: FormActor };

export function RoleList({ roles, actor }: Props) {
  const router = useRouter();
  const sorted = roles.toSorted((a, b) => b.position - a.position);
  const [editing, setEditing] = useState<RoleItem | "new" | null>(null);
  const [deleting, setDeleting] = useState<RoleItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function move(role: RoleItem, target: number) {
    setError(null);
    startTransition(async () => {
      const res = await moveRoleAction(role.id, target);
      if (res.error) {
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

      <ul className="flex flex-col rounded-panel border border-border bg-surface">
        {sorted.map((role, i) => {
          const manageable = canManageRole(role, actor);
          const above = sorted[i - 1];
          const below = sorted[i + 1];
          const upTarget = above?.position ?? 0;
          const downTarget = below && !below.isEveryone ? below.position : 0;
          const fixed = role.isEveryone || role.isSystem;
          const canUp = manageable && !fixed && !!above && canMoveTo(upTarget, actor);
          const canDown = manageable && !fixed && !!below && !below.isEveryone && canMoveTo(downTarget, actor);
          return (
            <li key={role.id} className="flex items-center gap-1 border-b border-border py-1 pl-4 pr-1 last:border-b-0">
              <span
                aria-hidden
                className="size-4 shrink-0 rounded-full border border-border-strong"
                style={{ backgroundColor: role.color }}
              />
              <div className="flex min-w-0 flex-1 flex-col px-2">
                <span className="truncate text-sm font-bold text-fg">{role.name}</span>
                <span className="text-xs text-fg-muted">
                  Posición {role.position}
                  {role.isEveryone ? " · base de todos" : role.isSystem ? " · sistema" : ""}
                </span>
              </div>
              <button
                type="button"
                aria-label={`Subir ${role.name}`}
                disabled={!canUp || pending}
                onClick={() => move(role, upTarget)}
                className={ICON_BUTTON}
              >
                <ArrowUp className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`Bajar ${role.name}`}
                disabled={!canDown || pending}
                onClick={() => move(role, downTarget)}
                className={ICON_BUTTON}
              >
                <ArrowDown className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`Editar ${role.name}`}
                disabled={!manageable || pending}
                onClick={() => setEditing(role)}
                className={ICON_BUTTON}
              >
                <Pencil className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`Borrar ${role.name}`}
                disabled={!manageable || fixed || role.systemKey !== null || pending}
                onClick={() => setDeleting(role)}
                className={cn(ICON_BUTTON, "hover:text-danger")}
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>

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
