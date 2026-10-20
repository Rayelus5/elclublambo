import { Diamond } from "@/components/loading-ui/diamond";
import { cn } from "@/lib/utils";

/**
 * Content-area fallback while a route segment streams in. The shell (sidebar, top bar) stays put: this only fills
 * `<main>`. It keeps the old fallback's `min-h-64`, and the diamond fades in after 150 ms (`animate-loader-in`), so a
 * fast navigation shows nothing. The status text is for screen readers; the diamond itself is decorative.
 */
export function PageLoader({ label = "Cargando…", className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn("flex min-h-64 items-center justify-center", className)}>
      <Diamond aria-hidden="true" role={undefined} aria-label={undefined} className="size-10 animate-loader-in text-accent" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
