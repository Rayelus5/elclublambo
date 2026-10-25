import Link from "next/link";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { localizedPath } from "@/lib/i18n/routes";

export function PublicFooter({ lang }: { lang: Lang }) {
  const t = getDictionary(lang);
  return (
    <footer className="mt-auto border-t border-border bg-bg">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-4 py-8 text-small text-fg-muted sm:px-8 lg:flex-row lg:items-center lg:justify-between">
        <p className="max-w-[44rem]">
          {t.common.noCustody} {t.connect.notAdvice}
        </p>
        <Link
          href={localizedPath(lang, "start")}
          className="inline-flex min-h-11 items-center font-bold text-fg underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent rounded-control"
        >
          {t.connect.whatIs}
        </Link>
        <p className="font-mono text-[0.75rem]">{t.connect.builtOn}</p>
      </div>
    </footer>
  );
}
