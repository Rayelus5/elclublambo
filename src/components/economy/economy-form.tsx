"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NetworkBadge } from "@/components/economy/network-badge";
import { setActiveChainAction, setChainAddressesAction, setMinFeeBpsAction } from "@/lib/economy/actions";
import type { ChainAddresses, EconomyConfig } from "@/lib/economy/config";
import {
  bpsToPercentText,
  CHAIN_IDS,
  feeOnTenUsdc,
  NETWORKS,
  percentTextToBps,
  type ChainId,
} from "@/lib/economy/networks";
import { rpcErrorMessage } from "@/lib/errors";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = /^0x0{40}$/;

function addressProblem(v: string): string | null {
  const t = v.trim();
  if (t === "") return null;
  return ADDRESS_RE.test(t) && !ZERO_ADDRESS.test(t) ? null : rpcErrorMessage("address_invalid");
}

/** What the switch confirmation warns about when the target network lacks addresses (ruling F3a-R4: still allowed). */
function missingWarning(name: string, a: ChainAddresses): string | null {
  const missing = [!a.safe && "la Safe", !a.platform && "la wallet de la plataforma"].filter(Boolean).join(" ni ");
  if (!missing) return null;
  return `${name} aún no tiene configurada ${missing}: los envíos de dinero estarán desactivados hasta que las configures.`;
}

function FeeCard({ minFeeBps }: { minFeeBps: number }) {
  const router = useRouter();
  const uid = useId();
  const [text, setText] = useState(bpsToPercentText(minFeeBps).replace(" %", ""));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const bps = percentTextToBps(text);

  function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    if (bps === null) {
      setError(rpcErrorMessage("fee_out_of_range"));
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await setMinFeeBpsAction(bps);
      if (res.error) {
        setError(rpcErrorMessage(res.error));
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4">
      <h3 className="text-h3">Comisión mínima</h3>
      <p className="text-sm text-fg-muted">
        Lo mínimo que se queda la plataforma de cada envío. Entre 0 % y 50 %, con hasta 2 decimales.
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${uid}-fee`}>Comisión mínima (%)</Label>
        <div className="flex gap-2">
          <Input
            id={`${uid}-fee`}
            inputMode="decimal"
            autoComplete="off"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSaved(false);
              setError(null);
            }}
            aria-invalid={error !== null}
            aria-describedby={`${uid}-preview`}
            disabled={pending}
            className="max-w-32"
          />
          <Button type="submit" disabled={pending}>
            {pending ? "Guardando…" : "Guardar comisión"}
          </Button>
        </div>
        <p id={`${uid}-preview`} className="font-mono text-[13px] text-fg-muted">
          {bps === null ? "Sobre 10 USDC: —" : `Sobre 10 USDC: ${feeOnTenUsdc(bps)} USDC`}
        </p>
        {error ? (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="text-[13px] text-success">
            Comisión guardada.
          </p>
        ) : null}
      </div>
    </form>
  );
}

function AddressesCard({ chain, addresses }: { chain: ChainId; addresses: ChainAddresses }) {
  const router = useRouter();
  const uid = useId();
  const name = NETWORKS[chain].name;
  const [safe, setSafe] = useState(addresses.safe ?? "");
  const [platform, setPlatform] = useState(addresses.platform ?? "");
  const [errors, setErrors] = useState<{ safe?: string; platform?: string; form?: string }>({});
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    const next = { safe: addressProblem(safe) ?? undefined, platform: addressProblem(platform) ?? undefined };
    setErrors(next);
    if (next.safe || next.platform) return;
    startTransition(async () => {
      // The RPC replaces both addresses: always send both (empty clears one).
      const res = await setChainAddressesAction({
        chain,
        safe: safe.trim() || null,
        platform: platform.trim() || null,
      });
      if (res.error) {
        setErrors({ form: rpcErrorMessage(res.error) });
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  const fields = [
    { key: "safe" as const, label: `Safe (${name})`, value: safe, set: setSafe },
    { key: "platform" as const, label: `Wallet de la plataforma (${name})`, value: platform, set: setPlatform },
  ];

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4">
      <h3 className="text-h3">{name}</h3>
      {fields.map((f) => (
        <div key={f.key} className="flex flex-col gap-2">
          <Label htmlFor={`${uid}-${f.key}`}>{f.label}</Label>
          <Input
            id={`${uid}-${f.key}`}
            value={f.value}
            onChange={(e) => {
              f.set(e.target.value);
              setSaved(false);
              setErrors((prev) => ({ ...prev, [f.key]: undefined, form: undefined }));
            }}
            placeholder="0x…"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={errors[f.key] !== undefined}
            disabled={pending}
            className="font-mono"
          />
          {errors[f.key] ? (
            <p role="alert" className="text-[13px] text-danger">
              {errors[f.key]}
            </p>
          ) : null}
        </div>
      ))}
      {errors.form ? (
        <p role="alert" className="text-[13px] text-danger">
          {errors.form}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-[13px] text-success">
          Direcciones guardadas.
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending} aria-label={`Guardar direcciones de ${name}`}>
          {pending ? "Guardando…" : "Guardar direcciones"}
        </Button>
      </div>
    </form>
  );
}

export function EconomyForm({ config }: { config: EconomyConfig }) {
  const router = useRouter();
  const [target, setTarget] = useState<ChainId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const targetName = target ? NETWORKS[target].name : "";
  const warning = target ? missingWarning(targetName, config.chains[target]) : null;

  function confirmSwitch() {
    const chain = target;
    if (!chain) return;
    setError(null);
    startTransition(async () => {
      const res = await setActiveChainAction(chain);
      setTarget(null);
      if (res.error) {
        setError(rpcErrorMessage(res.error));
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4">
        <h3 className="text-h3">Red activa</h3>
        <p className="text-sm text-fg-muted">La red en la que se mueve el dinero. Todos los miembros ven cuál es.</p>
        <div className="flex flex-wrap items-center gap-3">
          <NetworkBadge chainId={config.activeChainId} />
          {CHAIN_IDS.filter((id) => id !== config.activeChainId).map((id) => (
            <Button key={id} type="button" variant="outline" disabled={pending} onClick={() => setTarget(id)}>
              Cambiar a {NETWORKS[id].name}
            </Button>
          ))}
        </div>
        {error ? (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </section>

      <FeeCard key={`fee-${config.minFeeBps}`} minFeeBps={config.minFeeBps} />

      <div className="grid gap-6 lg:grid-cols-2">
        {CHAIN_IDS.map((id) => (
          <AddressesCard
            key={`${id}-${config.chains[id].safe}-${config.chains[id].platform}`}
            chain={id}
            addresses={config.chains[id]}
          />
        ))}
      </div>

      <AlertDialog open={target !== null} onOpenChange={(o) => !o && !pending && setTarget(null)}>
        <AlertDialogContent className="data-[size=default]:max-w-md data-[size=default]:sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Cambiar de red</AlertDialogTitle>
            <AlertDialogDescription>{`Los envíos de dinero pasarán a ${targetName}. ¿Continuar?`}</AlertDialogDescription>
          </AlertDialogHeader>
          {warning ? (
            <p className="rounded-control border border-warning p-3 text-[13px] text-warning">{warning}</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                confirmSwitch();
              }}
            >
              {pending ? "Cambiando…" : "Continuar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
