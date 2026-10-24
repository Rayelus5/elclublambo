import { Suspense } from "react";
import { DonateTrigger } from "@/components/donations/donate-dialog";
import { Button } from "@/components/ui/button";
import { donationChains } from "@/lib/economy/club-safe";

/** Resolves the networks where the club Safe exists (getCode, P1-R6) and hands them to the client trigger. */
export async function DonateButtonInner({ autoOpen = false }: { autoOpen?: boolean }) {
  const chains = await donationChains();
  if (chains.length === 0) {
    return (
      <Button type="button" disabled>
        Donaciones aún no disponibles
      </Button>
    );
  }
  return <DonateTrigger chains={chains} autoOpen={autoOpen} />;
}

/**
 * «Donar a ElClub.»: opens the donation dialog (`autoOpen` serves /donar?donar=1). While the Safe check runs, a disabled
 * placeholder holds its place; with no network available it stays disabled and says so.
 */
export function DonateButton({ autoOpen = false }: { autoOpen?: boolean }) {
  return (
    <Suspense
      fallback={
        <Button type="button" disabled>
          Donar a ElClub.
        </Button>
      }
    >
      <DonateButtonInner autoOpen={autoOpen} />
    </Suspense>
  );
}
