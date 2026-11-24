import Link from "next/link";
import { Button } from "@/components/ui/button";
import { clubPath } from "@/lib/club/paths";
import { getDictionary } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/routes";
import type { NotFoundVariant } from "@/lib/status/not-found-variant";
import { StatusShell } from "./status-shell";

export { notFoundBootScript, notFoundVariant, type NotFoundVariant } from "@/lib/status/not-found-variant";

export function NotFoundView({ variant }: { variant: NotFoundVariant }) {
  const lang = variant === "en" ? "en" : "es";
  const t = getDictionary(lang).status;
  if (variant === "foro") {
    return (
      <StatusShell lang="es" code="404" title={t.notFoundForoTitle} text={t.notFoundText}>
        <div>
          <Button asChild>
            <Link href={clubPath()}>{t.backForo}</Link>
          </Button>
        </div>
      </StatusShell>
    );
  }
  return (
    <StatusShell lang={lang} code="404" title={t.notFoundTitle} text={t.notFoundText}>
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href={localizedPath(lang, "home")}>{t.backHome}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={localizedPath(lang, "tools")}>{t.seeTools}</Link>
        </Button>
      </div>
    </StatusShell>
  );
}
