"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import { MemberAvatar } from "@/components/members/member-avatar";
import { Button } from "@/components/ui/button";
import type { MemberIdentity } from "@/lib/members/name";
import { setAvatarAction } from "@/lib/profile/actions";
import { uploadAvatar } from "@/lib/profile/upload";

export function AvatarUpload({ member }: { member: MemberIdentity }) {
  const input = useRef<HTMLInputElement>(null);
  const [avatarPath, setAvatarPath] = useState(member.avatarPath);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    start(async () => {
      try {
        const path = await uploadAvatar(file);
        const res = await setAvatarAction(path);
        if (res.ok) setAvatarPath(path);
        else setError(res.error);
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo subir la imagen. Inténtalo de nuevo.");
      }
    });
  }

  function remove() {
    setError(null);
    start(async () => {
      const res = await setAvatarAction(null);
      if (res.ok) setAvatarPath(null);
      else setError(res.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <MemberAvatar member={{ ...member, avatarPath }} size={96} />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={pending} onClick={() => input.current?.click()}>
            {pending ? "Subiendo…" : "Cambiar foto"}
          </Button>
          {avatarPath ? (
            <Button type="button" variant="ghost" disabled={pending} onClick={remove}>
              Quitar foto
            </Button>
          ) : null}
        </div>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-label="Elegir imagen de perfil" onChange={onFile} />
        <p className="text-small text-fg-muted">PNG, JPG o WebP, hasta 2 MB. Sin foto se muestra un avatar generado con tu wallet.</p>
        {error ? (
          <p role="alert" className="text-small text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
