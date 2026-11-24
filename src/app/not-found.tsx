import type { Metadata } from "next";
import { InlineScript } from "@/components/landing/inline-script";
import { NotFoundVariantSync } from "@/components/status/not-found-variant-sync";
import { NotFoundView, notFoundBootScript, type NotFoundVariant } from "@/components/status/not-found-view";

// A-R14: one 404 for the whole app (one root layout, so no global-not-found): URLs without a route, every notFound() and
// the proxy's 404 rewrites. Static, so the CDN serves it without running a function: the three variants (es / en / foro)
// are in the HTML and the URL picks one before the first paint (html[data-nf]: the inline boot script on a load,
// NotFoundVariantSync on a client navigation; globals.css shows the matching one, the Spanish one without either).
export const metadata: Metadata = {
  title: "404 · ElClub.",
  robots: { index: false, follow: false },
};

const VARIANTS: readonly NotFoundVariant[] = ["es", "en", "foro"];

export default function NotFound() {
  return (
    <>
      <InlineScript html={notFoundBootScript()} />
      <NotFoundVariantSync />
      {VARIANTS.map((variant) => (
        <div key={variant} data-nf-variant={variant}>
          <NotFoundView variant={variant} />
        </div>
      ))}
    </>
  );
}
