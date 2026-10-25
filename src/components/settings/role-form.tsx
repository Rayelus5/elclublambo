"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { rpcErrorMessage } from "@/lib/errors";
import { CHANNEL_BIT_LIST, GLOBAL_BIT_LIST, SAFE_ROLE_MASK } from "@/lib/permissions/labels";
import { createRoleAction, updateRoleAction } from "@/lib/roles/actions";
import type { RoleItem } from "@/lib/roles/rules";
import { cn } from "@/lib/utils";

/** Los colores de rol son datos (se guardan en la BD), no estilos de la interfaz. */
export const ROLE_COLOR_PALETTE = ["#3C8AFF", "#3DDC84", "#FFB020", "#FF5A5A", "#EDEDED", "#A3A3A3"] as const;
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const HEX_ERROR = "Usa un color hex de 6 dígitos, por ejemplo #3C8AFF.";
const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

export type FormActor = { isAdmin: boolean; /** bigint serializado */ perms: string; top: number };

type Props = {
  /** null = crear. */
  role: RoleItem | null;
  actor: FormActor;
  onDone?: () => void;
};

export function RoleForm({ role, actor, onDone }: Props) {
  const router = useRouter();
  const uid = useId();
  const isEveryone = role?.isEveryone ?? false;
  const restricted = isEveryone || (role?.systemKey ?? null) !== null;
  const actorPerms = BigInt(actor.perms || "0");

  const initialColor = role?.color ?? ROLE_COLOR_PALETTE[0];
  const inPalette = (ROLE_COLOR_PALETTE as readonly string[]).includes(initialColor.toUpperCase());
  const [name, setName] = useState(role?.name ?? "");
  const [palette, setPalette] = useState<string>(inPalette ? initialColor.toUpperCase() : "");
  const [custom, setCustom] = useState(inPalette ? "" : initialColor);
  const [bits, setBits] = useState<bigint>(BigInt(role?.permissions ?? "0") & ~512n);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const bitDisabled = (bit: bigint) => {
    if (pending) return true;
    if (actor.isAdmin) return false;
    if ((actorPerms & bit) === 0n) return true;
    return restricted && (SAFE_ROLE_MASK & bit) === 0n;
  };

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const finalName = isEveryone ? (role?.name ?? "") : name.trim();
    if (!isEveryone && (finalName.length < 1 || finalName.length > 32)) {
      setError("El nombre debe tener entre 1 y 32 caracteres.");
      return;
    }
    let color = role?.color ?? palette;
    if (!isEveryone) {
      color = custom.trim() !== "" ? custom.trim() : palette;
      if (!HEX_RE.test(color)) {
        setError(HEX_ERROR);
        return;
      }
      color = color.toUpperCase();
    }
    const permissions = bits.toString();
    startTransition(async () => {
      const res = role
        ? await updateRoleAction({ id: role.id, name: finalName, color, permissions })
        : await createRoleAction({ name: finalName, color, permissions });
      if (res.error) {
        setError(rpcErrorMessage(res.error));
        return;
      }
      router.refresh();
      onDone?.();
    });
  }

  const group = (title: string, list: readonly { bit: bigint; label: string }[]) => (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-[13px] font-bold text-fg-muted">{title}</legend>
      <div className="grid gap-x-4 sm:grid-cols-2">
        {list.map(({ bit, label }) => (
          <div key={label} className="flex min-h-11 items-center gap-3">
            <Checkbox
              id={`${uid}-${bit}`}
              checked={(bits & bit) !== 0n}
              disabled={bitDisabled(bit)}
              onCheckedChange={(v) => setBits((b) => (v === true ? b | bit : b & ~bit))}
            />
            <Label htmlFor={`${uid}-${bit}`} className="font-normal">
              {label}
            </Label>
          </div>
        ))}
      </div>
    </fieldset>
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      {isEveryone ? (
        <p className="text-sm text-fg-muted">
          @everyone es el rol base de todos los miembros: solo puedes cambiar sus permisos.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${uid}-name`}>Nombre</Label>
            <Input
              id={`${uid}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
              disabled={pending || (role?.systemKey ?? null) !== null}
              aria-describedby={role?.systemKey ? `${uid}-name-hint` : undefined}
            />
            {role?.systemKey ? (
              <p id={`${uid}-name-hint`} className="text-[13px] text-fg-muted">
                Nombre fijo del sistema
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <span id={`${uid}-color`} className="text-sm font-medium text-fg">
              Color
            </span>
            <div role="radiogroup" aria-labelledby={`${uid}-color`} className="flex flex-wrap gap-1">
              {ROLE_COLOR_PALETTE.map((hex) => {
                const checked = custom.trim() === "" && palette === hex;
                return (
                  <button
                    key={hex}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    aria-label={hex}
                    disabled={pending}
                    onClick={() => {
                      setPalette(hex);
                      setCustom("");
                    }}
                    className={cn("flex size-11 items-center justify-center rounded-control", FOCUS)}
                  >
                    <span
                      className={cn(
                        "size-7 rounded-full border-2",
                        checked ? "border-fg" : "border-border-strong",
                      )}
                      style={{ backgroundColor: hex }}
                    />
                  </button>
                );
              })}
            </div>
            <Label htmlFor={`${uid}-custom`}>Color personalizado</Label>
            <Input
              id={`${uid}-custom`}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="#3C8AFF"
              maxLength={7}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              disabled={pending}
            />
          </div>
        </>
      )}

      <div className="flex flex-col gap-4">
        {group("Permisos globales", GLOBAL_BIT_LIST)}
        {group("Permisos de canal (base)", CHANNEL_BIT_LIST)}
        <p className="text-[13px] text-fg-muted">
          Solo puedes dar permisos que tú tienes. Los canales pueden cambiarlos con sus propios overwrites.
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-control border border-danger px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : role ? "Guardar" : "Crear rol"}
        </Button>
      </div>
    </form>
  );
}
