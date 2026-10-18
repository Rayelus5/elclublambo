"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveProfileAction, setHandleAction } from "@/lib/profile/actions";
import { cn } from "@/lib/utils";

export const BIO_MAX = 280;
export const LINKS_MAX = 3;

const dateFmt = new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "UTC" });

const FIELD = "flex flex-col gap-2";

export type ProfileFormProps = {
  handle: string | null;
  displayName: string;
  bio: string;
  links: string[];
  /** ISO date when the handle can change again; null when it can change now. */
  handleNextChangeAt: string | null;
};

type Status = { kind: "ok" | "error"; text: string } | null;

export function ProfileForm(props: ProfileFormProps) {
  const [handle, setHandle] = useState(props.handle ?? "");
  const [savedHandle, setSavedHandle] = useState(props.handle);
  const [locked, setLocked] = useState(props.handleNextChangeAt);
  const [name, setName] = useState(props.displayName);
  const [bio, setBio] = useState(props.bio);
  const [links, setLinks] = useState<string[]>(props.links);
  const [handleStatus, setHandleStatus] = useState<Status>(null);
  const [status, setStatus] = useState<Status>(null);
  const [pendingHandle, startHandle] = useTransition();
  const [pending, start] = useTransition();

  const remaining = BIO_MAX - [...bio].length;
  const handleDirty = handle.trim().toLowerCase() !== (savedHandle ?? "");

  function submitHandle(e: FormEvent) {
    e.preventDefault();
    setHandleStatus(null);
    startHandle(async () => {
      const res = await setHandleAction(handle);
      if (res.ok) {
        setSavedHandle(res.handle);
        setHandle(res.handle);
        setLocked(new Date(Date.now() + 30 * 86_400_000).toISOString());
        setHandleStatus({ kind: "ok", text: "@handle actualizado." });
      } else {
        setHandleStatus({ kind: "error", text: res.error });
      }
    });
  }

  function submitProfile(e: FormEvent) {
    e.preventDefault();
    if (remaining < 0) return;
    setStatus(null);
    start(async () => {
      const res = await saveProfileAction({
        displayName: name.trim(),
        bio: bio.trim(),
        links: links.map((l) => l.trim()).filter(Boolean),
      });
      setStatus(res.ok ? { kind: "ok", text: "Perfil guardado." } : { kind: "error", text: res.error });
    });
  }

  return (
    <div className="flex flex-col gap-10">
      <form onSubmit={submitHandle} className="flex flex-col gap-3" noValidate>
        <div className={FIELD}>
          <Label htmlFor="profile-handle">@handle</Label>
          <div className="flex flex-wrap gap-3">
            <Input
              id="profile-handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              disabled={locked !== null}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={20}
              aria-describedby="profile-handle-help"
              className="max-w-xs flex-1 font-mono"
            />
            <Button type="submit" variant="secondary" disabled={locked !== null || pendingHandle || !handleDirty || handle.trim() === ""}>
              Cambiar @handle
            </Button>
          </div>
          <p id="profile-handle-help" className="text-small text-fg-muted">
            {locked !== null
              ? `Podrás cambiarlo de nuevo el ${dateFmt.format(new Date(locked))}`
              : "3 a 20 caracteres: letras sin acentos, números o guion bajo. Solo puedes cambiarlo una vez cada 30 días."}
          </p>
        </div>
        <StatusLine status={handleStatus} />
      </form>

      <form onSubmit={submitProfile} className="flex flex-col gap-6" noValidate>
        <div className={FIELD}>
          <Label htmlFor="profile-name">Nombre</Label>
          <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} autoComplete="off" className="max-w-md" />
          <p className="text-small text-fg-muted">Opcional, de 2 a 32 caracteres. Si lo dejas vacío se mostrará tu @handle.</p>
        </div>

        <div className={FIELD}>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="profile-bio">Bio</Label>
            <span className={cn("font-mono text-small", remaining < 0 ? "text-danger" : "text-fg-muted")} aria-live="polite">
              {remaining}
            </span>
          </div>
          <textarea
            id="profile-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={4}
            aria-invalid={remaining < 0}
            className="w-full rounded-control border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger md:text-sm"
          />
          {remaining < 0 ? <p className="text-small text-danger">La bio puede tener como máximo {BIO_MAX} caracteres.</p> : null}
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">Enlaces</legend>
          <p className="text-small text-fg-muted">Hasta {LINKS_MAX}, solo https. Los de dominios no autorizados se abren con aviso.</p>
          {links.map((link, i) => (
            <div key={i} className="flex gap-2">
              <Input
                aria-label={`Enlace ${i + 1}`}
                type="url"
                inputMode="url"
                placeholder="https://"
                value={link}
                onChange={(e) => setLinks(links.map((l, j) => (j === i ? e.target.value : l)))}
                maxLength={200}
                autoComplete="off"
              />
              <Button type="button" variant="ghost" size="icon" aria-label={`Quitar enlace ${i + 1}`} onClick={() => setLinks(links.filter((_, j) => j !== i))}>
                <X aria-hidden />
              </Button>
            </div>
          ))}
          {links.length < LINKS_MAX ? (
            <Button type="button" variant="secondary" className="self-start" onClick={() => setLinks([...links, ""])}>
              <Plus aria-hidden />
              Añadir enlace
            </Button>
          ) : null}
        </fieldset>

        <div className="flex flex-col gap-3">
          <Button type="submit" className="self-start" disabled={pending || remaining < 0}>
            Guardar perfil
          </Button>
          <StatusLine status={status} />
        </div>
      </form>
    </div>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  return status.kind === "error" ? (
    <p role="alert" className="text-small text-danger">
      {status.text}
    </p>
  ) : (
    <p role="status" className="text-small text-success">
      {status.text}
    </p>
  );
}
