import type { ReactNode } from "react";
import type { Lang } from "@/lib/i18n/config";
import { StatusMark } from "./status-mark";

type Props = {
  lang: Lang;
  code: "503" | "404";
  title: string;
  /** A string or richer content (the custom maintenance message keeps its line breaks). */
  text: ReactNode;
  children?: ReactNode;
};

/**
 * The family of status pages (maintenance, unavailable tool, 404): code → title → text → action, with the drifting logo
 * square on the left from `md` and above the text on phones. Outside the public layout on purpose: no header, no footer.
 */
export function StatusShell({ lang, code, title, text, children }: Props) {
  return (
    <main lang={lang} className="flex w-full flex-1 items-center justify-center px-4 py-16 sm:py-24">
      <div className="flex w-full max-w-2xl flex-col gap-8 md:flex-row md:items-start md:gap-12">
        <StatusMark />
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <div className="flex flex-col gap-3">
            <p className="font-mono text-sm tracking-widest text-fg-muted">{code}</p>
            <h1 className="font-display text-3xl leading-tight font-black tracking-[-0.02em] text-balance text-fg semiwide sm:text-4xl">{title}</h1>
            <div className="max-w-prose text-base leading-relaxed text-fg-muted">{text}</div>
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}
