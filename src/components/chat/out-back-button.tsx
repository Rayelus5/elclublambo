"use client";

import { clubPath } from "@/lib/club/paths";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/** Goes back in history when there is somewhere to go back to; otherwise to the forum home. */
export function OutBackButton() {
  const router = useRouter();
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(clubPath());
      }}
    >
      Volver
    </Button>
  );
}
