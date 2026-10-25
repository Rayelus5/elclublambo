import type { Dictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { localizedPath } from "@/lib/i18n/routes";
import { buildPayUrl } from "@/lib/pay/link";
import { CopyButton } from "./copy-button";

type Tool = Dictionary["pay"]["tool"];

/** The embeddable button (P3-R5): a link wrapping the SVG badge, no iframe and no script. The preview is the very image. */
export function EmbedSnippet({ lang, t, alias, origin }: { lang: Lang; t: Tool; alias: string; origin: string }) {
  const badgePath = `${localizedPath(lang, "pay", { target: alias })}/badge`;
  const code = `<a href="${buildPayUrl(origin, lang, alias)}"><img src="${origin.replace(/\/+$/, "")}${badgePath}" alt="${t.badgeAlt}" width="240" height="56"></a>`;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold text-fg">{t.embedPreview}</p>
        <div className="rounded-control border border-border bg-surface p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- the SVG badge is the product itself */}
          <img src={badgePath} alt={t.badgeAlt} width={240} height={56} className="h-14 w-60 max-w-full" />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="pay-embed-code" className="text-sm font-bold text-fg">
          {t.embedCode}
        </label>
        <textarea
          id="pay-embed-code"
          readOnly
          rows={4}
          value={code}
          className="min-h-11 w-full resize-y break-all rounded-control border border-input bg-transparent px-2.5 py-2 font-mono text-[13px] text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        />
      </div>
      <CopyButton text={code} label={t.copyCode} doneText={t.codeCopied} failedText={t.copyFailed} />
    </div>
  );
}
