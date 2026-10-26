import Link from "next/link";
import { connection } from "next/server";
import { Button } from "@/components/ui/button";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { localizedPath } from "@/lib/i18n/routes";
import { StatusShell } from "./status-shell";

/** «Esta herramienta no está disponible ahora». Rendered per request (see MaintenanceContent): its 503 stays `no-store`. */
export async function UnavailableContent({ lang }: { lang: Lang }) {
  await connection();
  const t = getDictionary(lang).status;
  return (
    <StatusShell lang={lang} code="503" title={t.unavailableTitle} text={t.unavailableText}>
      <div>
        <Button asChild>
          <Link href={localizedPath(lang, "tools")}>{t.seeTools}</Link>
        </Button>
      </div>
    </StatusShell>
  );
}
