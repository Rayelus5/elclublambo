import { Suspense } from "react";
import { NoAccessView } from "@/components/auth/no-access-view";
import { knownErrorCode } from "@/lib/errors";

// searchParams es dinámico: con cacheComponents debe leerse dentro de un Suspense.
async function NoAccessContent({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const { error } = await searchParams;
  return <NoAccessView errorCode={knownErrorCode(error)} />;
}

export default function NoAccessPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  return (
    <Suspense fallback={<NoAccessView errorCode={null} />}>
      <NoAccessContent searchParams={searchParams} />
    </Suspense>
  );
}
