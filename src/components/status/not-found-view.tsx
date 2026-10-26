import Link from "next/link";
import { headers } from "next/headers";
import { Button } from "@/components/ui/button";
import { clubPath } from "@/lib/club/paths";
import { getDictionary } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/routes";
import { StatusShell } from "./status-shell";

export type NotFoundVariant = "es" | "en" | "foro";

/** A-R14: the variant from the proxy's `x-pathname` (path + query). `/en…` → en, the club → foro (Spanish), else es. */
export function notFoundVariant(xPathname: string | null): NotFoundVariant {
  const path = (xPathname ?? "").split(/[?#]/)[0] ?? "";
  const first = path.split("/").filter(Boolean)[0];
  if (first === "en") return "en";
  if (`/${first}` === clubPath()) return "foro";
  return "es";
}

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

/** The root 404 reads the request header, so it lives inside the not-found page's <Suspense>. */
export async function NotFoundFromRequest() {
  return <NotFoundView variant={notFoundVariant((await headers()).get("x-pathname"))} />;
}
