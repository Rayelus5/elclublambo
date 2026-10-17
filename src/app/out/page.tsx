import { Suspense } from "react";
import type { Metadata } from "next";
import { OutView } from "@/components/chat/out-view";

export const metadata: Metadata = {
  title: "Salir de El Club",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{ u?: string | string[] }>;

// searchParams es dinámico: con cacheComponents se lee dentro de un Suspense.
async function OutContent({ searchParams }: { searchParams: SearchParams }) {
  const { u } = await searchParams;
  return <OutView u={Array.isArray(u) ? u[0] : u} />;
}

export default function OutPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="mx-auto flex w-full max-w-[520px] flex-1 flex-col justify-center px-4 py-12 sm:px-6 sm:py-16">
      <Suspense fallback={<p className="text-fg-muted">Comprobando enlace…</p>}>
        <OutContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
