"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Minus, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { searchMembersAction, setOverwriteAction, type MemberHit } from "@/lib/channels/actions";
import { shortAddress } from "@/lib/auth/wallet";
import { rpcErrorMessage } from "@/lib/errors";
import { CHANNEL_BIT_LIST } from "@/lib/permissions/labels";
import { cycleState, getState, setState, type TriState } from "@/lib/permissions/overwrite-state";
import { cn } from "@/lib/utils";

export type TargetType = "role" | "member";
export type OverwriteRow = { targetType: TargetType; targetId: string; allow: string; deny: string };
export type MatrixRole = {
  id: string;
  name: string;
  color: string;
  position: number;
  isEveryone: boolean;
  /** Rol con el bit de administrador (SuperAdmin): nunca es destino de un overwrite. */
  isAdminRole: boolean;
};
export type MatrixMember = { id: string; displayName: string | null; walletAddress: string };

type Props = {
  channelId: string;
  overwrites: OverwriteRow[];
  roles: MatrixRole[];
  members: MatrixMember[];
  /** Bits de canal del actor en este canal (bigint serializado). */
  actorChannelPerms: string;
  isAdmin: boolean;
  actorTop: number;
};

type Pair = { allow: bigint; deny: bigint };
const keyOf = (t: TargetType, id: string) => `${t}:${id}`;
const STATE_TEXT: Record<TriState, string> = { inherit: "heredar", allow: "permitido", deny: "denegado" };
const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";
const SELECT_CLASS =
  "min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 text-sm text-fg outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50";

function StateIcon({ state }: { state: TriState }) {
  if (state === "allow") return <Check className="size-4 text-success" aria-hidden />;
  if (state === "deny") return <X className="size-4 text-danger" aria-hidden />;
  return <Minus className="size-4 text-fg-muted" aria-hidden />;
}

export function PermissionMatrix({ channelId, overwrites, roles, members, actorChannelPerms, isAdmin, actorTop }: Props) {
  const router = useRouter();
  const uid = useId();
  const actorBits = BigInt(actorChannelPerms || "0");
  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);

  const [added, setAdded] = useState<{ targetType: TargetType; targetId: string }[]>([]);
  const [knownMembers, setKnownMembers] = useState<MatrixMember[]>(members);
  const [values, setValues] = useState<Record<string, Pair>>({});
  const [saved, setSaved] = useState<Record<string, Pair>>({});
  const [removed, setRemoved] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<MemberHit[] | null>(null);
  const [searching, startSearch] = useTransition();

  const propPair = (t: TargetType, id: string): Pair => {
    const o = overwrites.find((x) => x.targetType === t && x.targetId === id);
    return { allow: BigInt(o?.allow ?? "0"), deny: BigInt(o?.deny ?? "0") };
  };
  const baseOf = (t: TargetType, id: string): Pair => saved[keyOf(t, id)] ?? propPair(t, id);
  const currentOf = (t: TargetType, id: string): Pair => values[keyOf(t, id)] ?? baseOf(t, id);

  const rows = useMemo(() => {
    const list: { targetType: TargetType; targetId: string }[] = [];
    const seen = new Set<string>();
    for (const o of [...overwrites, ...added]) {
      const k = keyOf(o.targetType, o.targetId);
      if (seen.has(k) || removed.includes(k)) continue;
      seen.add(k);
      list.push({ targetType: o.targetType, targetId: o.targetId });
    }
    return list.toSorted((a, b) => {
      if (a.targetType !== b.targetType) return a.targetType === "role" ? -1 : 1;
      if (a.targetType === "member") return 0;
      return (roleById.get(b.targetId)?.position ?? -1) - (roleById.get(a.targetId)?.position ?? -1);
    });
  }, [overwrites, added, removed, roleById]);

  const rowKeys = new Set(rows.map((r) => keyOf(r.targetType, r.targetId)));
  const addableRoles = roles.filter(
    (r) => !rowKeys.has(keyOf("role", r.id)) && !r.isAdminRole && (isAdmin || r.isEveryone || r.position < actorTop),
  );

  function describe(t: TargetType, id: string): { name: string; sub?: string; color?: string; locked: boolean } {
    if (t === "role") {
      const r = roleById.get(id);
      if (!r) return { name: "Rol desconocido", locked: true };
      return {
        name: r.name,
        color: r.color,
        locked: r.isAdminRole || (!isAdmin && !r.isEveryone && r.position >= actorTop),
      };
    }
    const m = knownMembers.find((x) => x.id === id);
    return {
      name: m?.displayName || (m ? shortAddress(m.walletAddress) : "Miembro"),
      sub: m ? shortAddress(m.walletAddress) : undefined,
      // La jerarquía de miembros la valida el servidor.
      locked: false,
    };
  }

  function toggle(t: TargetType, id: string, bit: bigint) {
    const cur = currentOf(t, id);
    const next = setState(cur.allow, cur.deny, bit, cycleState(getState(cur.allow, cur.deny, bit)));
    setValues((v) => ({ ...v, [keyOf(t, id)]: next }));
    setError(null);
  }

  function persist(t: TargetType, id: string, pair: Pair, afterOk?: () => void) {
    const k = keyOf(t, id);
    setBusy(k);
    setError(null);
    startTransition(async () => {
      const res = await setOverwriteAction(channelId, t, id, pair.allow.toString(), pair.deny.toString());
      setBusy(null);
      if (res.error) {
        setError(rpcErrorMessage(res.error));
        return;
      }
      setSaved((s) => ({ ...s, [k]: pair }));
      afterOk?.();
      router.refresh();
    });
  }

  function remove(t: TargetType, id: string) {
    const k = keyOf(t, id);
    const existing = overwrites.some((o) => o.targetType === t && o.targetId === id);
    const drop = () => {
      setRemoved((r) => [...r, k]);
      setAdded((a) => a.filter((x) => keyOf(x.targetType, x.targetId) !== k));
      setValues((v) => Object.fromEntries(Object.entries(v).filter(([key]) => key !== k)));
    };
    if (!existing) {
      drop();
      return;
    }
    persist(t, id, { allow: 0n, deny: 0n }, drop);
  }

  function addRow(t: TargetType, id: string) {
    const k = keyOf(t, id);
    setRemoved((r) => r.filter((x) => x !== k));
    setAdded((a) => (a.some((x) => keyOf(x.targetType, x.targetId) === k) ? a : [...a, { targetType: t, targetId: id }]));
  }

  function runSearch(e: React.FormEvent) {
    e.preventDefault();
    startSearch(async () => {
      setHits(await searchMembersAction(query));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p role="alert" className="rounded-control border border-danger px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-panel border border-border bg-surface">
        <table className="w-full min-w-max border-collapse text-sm">
          <caption className="sr-only">
            Permisos por destino. Cada celda alterna entre heredar, permitido y denegado.
          </caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="sticky left-0 z-10 min-w-40 bg-surface px-3 py-2 text-left font-bold text-fg">
                Destino
              </th>
              {CHANNEL_BIT_LIST.map((b) => (
                <th
                  key={b.label}
                  scope="col"
                  className="w-24 min-w-24 px-1 py-2 text-center text-xs font-medium leading-tight text-fg-muted"
                >
                  {b.label}
                </th>
              ))}
              <th scope="col" className="px-2 py-2 text-right text-xs font-medium text-fg-muted">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={CHANNEL_BIT_LIST.length + 2} className="px-3 py-6 text-center text-fg-muted">
                  Sin permisos propios: este canal hereda todo. Añade un rol o un miembro.
                </td>
              </tr>
            ) : null}
            {rows.map((row) => {
              const info = describe(row.targetType, row.targetId);
              const cur = currentOf(row.targetType, row.targetId);
              const base = baseOf(row.targetType, row.targetId);
              const dirty = cur.allow !== base.allow || cur.deny !== base.deny;
              const k = keyOf(row.targetType, row.targetId);
              const rowBusy = busy === k;
              return (
                <tr key={k} className="border-b border-border last:border-b-0">
                  <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-1 text-left font-normal">
                    <span className="flex items-center gap-2">
                      {info.color ? (
                        <span
                          aria-hidden
                          className="size-3 shrink-0 rounded-full border border-border-strong"
                          style={{ backgroundColor: info.color }}
                        />
                      ) : null}
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium text-fg">{info.name}</span>
                        {info.sub ? <span className="font-mono text-xs text-fg-muted">{info.sub}</span> : null}
                      </span>
                    </span>
                  </th>
                  {CHANNEL_BIT_LIST.map((b) => {
                    const state = getState(cur.allow, cur.deny, b.bit);
                    const lacks = !isAdmin && (actorBits & b.bit) === 0n;
                    return (
                      <td key={b.label} className="px-1 py-1 text-center">
                        <button
                          type="button"
                          aria-label={`${info.name} · ${b.label}: ${STATE_TEXT[state]}`}
                          disabled={info.locked || lacks || rowBusy}
                          onClick={() => toggle(row.targetType, row.targetId, b.bit)}
                          className={cn(
                            "mx-auto flex size-11 items-center justify-center rounded-control border transition-colors duration-150 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
                            state === "allow" && "border-success",
                            state === "deny" && "border-danger",
                            state === "inherit" && "border-border",
                            FOCUS,
                          )}
                        >
                          <StateIcon state={state} />
                        </button>
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap px-2 py-1 text-right">
                    <Button
                      type="button"
                      size="sm"
                      aria-label={`Guardar ${info.name}`}
                      disabled={info.locked || !dirty || rowBusy}
                      onClick={() => persist(row.targetType, row.targetId, cur)}
                    >
                      {rowBusy ? "Guardando…" : "Guardar"}
                    </Button>
                    <button
                      type="button"
                      aria-label={`Quitar ${info.name}`}
                      disabled={info.locked || rowBusy}
                      onClick={() => remove(row.targetType, row.targetId)}
                      className={cn(
                        "ml-1 inline-flex size-11 items-center justify-center rounded-control text-fg-muted transition-colors duration-150 hover:bg-surface-2 hover:text-danger disabled:opacity-40 motion-reduce:transition-none",
                        FOCUS,
                      )}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
        <span className="inline-flex items-center gap-1">
          <Check className="size-3.5 text-success" aria-hidden /> permitido
        </span>
        <span className="inline-flex items-center gap-1">
          <Minus className="size-3.5" aria-hidden /> heredar
        </span>
        <span className="inline-flex items-center gap-1">
          <X className="size-3.5 text-danger" aria-hidden /> denegado
        </span>
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${uid}-role`}>Añadir rol</Label>
          <select
            id={`${uid}-role`}
            value=""
            onChange={(e) => e.target.value && addRow("role", e.target.value)}
            disabled={addableRoles.length === 0}
            className={SELECT_CLASS}
          >
            <option value="">{addableRoles.length === 0 ? "No hay más roles" : "Elige un rol…"}</option>
            {addableRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <form onSubmit={runSearch} className="flex flex-col gap-2" role="search" aria-label="Buscar miembro">
          <Label htmlFor={`${uid}-member`}>Añadir miembro</Label>
          <div className="flex gap-2">
            <Input
              id={`${uid}-member`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nombre o wallet"
              autoComplete="off"
            />
            <Button type="submit" variant="secondary" disabled={searching || query.trim().length < 2}>
              <Search aria-hidden />
              Buscar
            </Button>
          </div>
          {hits ? (
            hits.length === 0 ? (
              <p className="text-sm text-fg-muted">Sin resultados.</p>
            ) : (
              <ul className="flex flex-col rounded-control border border-border">
                {hits.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setKnownMembers((m) => (m.some((x) => x.id === h.id) ? m : [...m, h]));
                        addRow("member", h.id);
                        setHits(null);
                        setQuery("");
                      }}
                      className={cn(
                        "flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm hover:bg-surface-2",
                        FOCUS,
                      )}
                    >
                      <span className="truncate">{h.displayName || shortAddress(h.walletAddress)}</span>
                      <span className="font-mono text-xs text-fg-muted">{shortAddress(h.walletAddress)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </form>
      </div>
    </div>
  );
}
