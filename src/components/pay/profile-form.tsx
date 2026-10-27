"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { chainsForSet, NETWORK_KEYS, NETWORKS, networkSet, type NetworkKey } from "@/lib/economy/networks";
import type { Dictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { savePublicProfileAction } from "@/lib/pay/actions";
import { normalizeAlias } from "@/lib/pay/alias";
import type { MyPublicProfile, SaveProfileError } from "@/lib/pay/types";

const NAME_MAX = 40;
type Tool = Dictionary["pay"]["tool"];
type FieldErrors = { alias?: string; name?: string; networks?: string };

/** Display name and logo of each payment network in this build's set. */
function networkOptions(): { key: NetworkKey; name: string; logo: string }[] {
  const chains = chainsForSet(networkSet());
  return NETWORK_KEYS.flatMap((key) => {
    const chain = chains.find((c) => NETWORKS[c].key === key);
    return chain === undefined ? [] : [{ key, name: key === "base" ? "Base" : "Arbitrum", logo: NETWORKS[chain].logo }];
  });
}

function FieldError({ id, children }: { id: string; children?: string }) {
  return children ? (
    <p id={id} role="alert" className="text-sm text-danger">
      {children}
    </p>
  ) : null;
}

/** The ElClub Pay profile: alias, optional name, receiving networks and (members only) the club badge. One column, errors under their field. */
export function ProfileForm({ t, initial, isMember }: { lang: Lang; t: Tool; initial: MyPublicProfile | null; isMember: boolean }) {
  const router = useRouter();
  const options = networkOptions();
  const [alias, setAlias] = useState(initial?.alias ?? "");
  const [name, setName] = useState(initial?.displayName ?? "");
  const [networks, setNetworks] = useState<NetworkKey[]>(initial?.acceptNetworks ?? options.map((o) => o.key));
  const [badge, setBadge] = useState(initial?.showMemberBadge ?? false);
  const [fe, setFe] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  function toggle(key: NetworkKey, on: boolean) {
    setSaved(false);
    setNetworks((cur) => options.map((o) => o.key).filter((k) => (k === key ? on : cur.includes(k))));
  }

  function place(error: SaveProfileError): FieldErrors | null {
    if (error === "alias_invalid" || error === "alias_reserved" || error === "alias_taken") return { alias: t.errors[error] };
    if (error === "networks_invalid") return { networks: t.errors.networks_invalid };
    if (error === "display_name_invalid") return { name: t.errors.display_name_invalid };
    return null;
  }

  function focusFirstInvalid() {
    requestAnimationFrame(() => document.querySelector<HTMLElement>("form [aria-invalid='true']")?.focus());
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaved(false);
    const next: FieldErrors = {};
    const a = normalizeAlias(alias);
    if (!a.ok) next.alias = t.errors[a.error];
    if (name.trim().length > NAME_MAX) next.name = t.errors.display_name_invalid;
    if (networks.length === 0) next.networks = t.errors.networks_invalid;
    setFe(next);
    if (!a.ok || next.name || next.networks) {
      focusFirstInvalid();
      return;
    }
    start(async () => {
      try {
        const r = await savePublicProfileAction({ alias: a.alias, displayName: name.trim(), acceptNetworks: networks, showMemberBadge: isMember && badge });
        if (r.ok) {
          setAlias(r.profile.alias);
          setSaved(true);
          router.refresh();
          return;
        }
        const field = place(r.error);
        if (field) {
          setFe(field);
          focusFirstInvalid();
        } else {
          setFormError(t.errors[r.error] ?? t.errors.unknown);
        }
      } catch {
        setFormError(t.errors.unknown);
      }
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <label htmlFor="pay-alias" className="text-sm font-bold text-fg">
          {t.aliasLabel}
        </label>
        <Input
          id="pay-alias"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={20}
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          disabled={pending}
          aria-invalid={fe.alias ? true : undefined}
          aria-describedby={fe.alias ? "pay-alias-hint pay-alias-err" : "pay-alias-hint"}
        />
        <p id="pay-alias-hint" className="text-[13px] text-fg-muted">
          {t.aliasHint}
        </p>
        <FieldError id="pay-alias-err">{fe.alias}</FieldError>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="pay-name" className="text-sm font-bold text-fg">
          {t.displayNameLabel}
        </label>
        <Input
          id="pay-name"
          autoComplete="off"
          maxLength={NAME_MAX}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={pending}
          aria-invalid={fe.name ? true : undefined}
          aria-describedby={fe.name ? "pay-name-hint pay-name-err" : "pay-name-hint"}
        />
        <p id="pay-name-hint" className="text-[13px] text-fg-muted">
          {t.displayNameHint}
        </p>
        <FieldError id="pay-name-err">{fe.name}</FieldError>
      </div>

      <fieldset className="flex flex-col gap-2" aria-describedby="pay-networks-hint">
        <legend className="mb-1 text-sm font-bold text-fg">{t.networksLabel}</legend>
        {options.map((o) => (
          <label key={o.key} htmlFor={`pay-net-${o.key}`} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control border border-border px-3">
            <Checkbox
              id={`pay-net-${o.key}`}
              checked={networks.includes(o.key)}
              onCheckedChange={(v) => toggle(o.key, v === true)}
              disabled={pending}
              aria-invalid={fe.networks ? true : undefined}
              aria-describedby={fe.networks ? "pay-networks-err" : undefined}
            />
            {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVG from /public */}
            <img src={o.logo} alt="" width={20} height={20} className="rounded-full" />
            <span className="text-base text-fg">{o.name}</span>
          </label>
        ))}
        <p id="pay-networks-hint" className="flex items-start gap-2 text-[13px] text-fg-muted">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
          <span>{t.networksHint}</span>
        </p>
        <FieldError id="pay-networks-err">{fe.networks}</FieldError>
      </fieldset>

      {isMember ? (
        <label htmlFor="pay-badge" className="flex min-h-11 cursor-pointer items-center gap-3">
          <Checkbox id="pay-badge" checked={badge} onCheckedChange={(v) => setBadge(v === true)} disabled={pending} />
          <span className="text-base text-fg">{t.badgeLabel}</span>
        </label>
      ) : null}

      <p className="flex items-start gap-2 rounded-control border border-accent p-3 text-sm text-fg">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
        {t.addressNotice}
      </p>

      {formError ? (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? t.saving : t.save}
        </Button>
        <p role="status" aria-live="polite" className="min-h-5 text-sm text-success">
          {saved ? t.saved : ""}
        </p>
      </div>
    </form>
  );
}
