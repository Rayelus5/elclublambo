import { connection } from "next/server";
import { x402Config } from "@/lib/checker/x402";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { siteOrigin } from "@/lib/start/site";

const TOKEN_ENDPOINT = "GET /api/v1/check/token?chain=<id>&address=<0x…>";
const LINK_ENDPOINT = "GET /api/v1/check/link?url=<encoded>";
const RESPONSE = `{
  "version": 1,
  "kind": "token" | "link",
  "report": { … },
  "disclaimer": "…"
}`;

function Code({ children }: { children: string }) {
  return (
    <pre tabIndex={0} className="max-w-full overflow-x-auto rounded-control border border-border-strong bg-surface p-3 font-mono text-small text-fg">
      <code>{children}</code>
    </pre>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h2 className="font-display text-xl font-bold text-fg">{title}</h2>
      {children}
    </section>
  );
}

/** Endpoints, examples, response shape and limits: static, nothing read from the request. */
export function ApiDocsBody({ lang }: { lang: Lang }) {
  const t = getDictionary(lang).checker.api;
  const origin = siteOrigin().origin;
  return (
    <>
      <Section title={t.endpointsTitle}>
        <h3 className="font-bold text-fg">{t.tokenTitle}</h3>
        <p className="text-base text-fg-muted">{t.tokenText}</p>
        <Code>{TOKEN_ENDPOINT}</Code>
        <Code>{`curl "${origin}/api/v1/check/token?chain=8453&address=0x4200000000000000000000000000000000000006"`}</Code>
        <h3 className="mt-2 font-bold text-fg">{t.linkTitle}</h3>
        <p className="text-base text-fg-muted">{t.linkText}</p>
        <Code>{LINK_ENDPOINT}</Code>
        <Code>{`curl "${origin}/api/v1/check/link?url=https%3A%2F%2Fexample.com"`}</Code>
      </Section>
      <Section title={t.responseTitle}>
        <p className="text-base text-fg-muted">{t.responseText}</p>
        <Code>{RESPONSE}</Code>
      </Section>
      <Section title={t.limitsTitle}>
        <p className="text-base text-fg-muted">{t.limitsText}</p>
      </Section>
    </>
  );
}

/** The current pricing, read from the environment when the page is requested (never baked at build). */
export async function ApiDocsStatus({ lang }: { lang: Lang }) {
  await connection();
  const t = getDictionary(lang).checker.api;
  const cfg = x402Config();
  return (
    <Section title={t.statusTitle}>
      {cfg.enabled ? (
        <>
          <p className="text-base text-fg">{t.statusPaid.replace("{network}", t.networks[cfg.network]).replace("{price}", cfg.price)}</p>
          <p className="text-base text-fg-muted">{t.payHow}</p>
        </>
      ) : (
        <p className="text-base text-fg">{t.statusFree}</p>
      )}
      <p className="text-small text-fg-muted">{t.note}</p>
    </Section>
  );
}
