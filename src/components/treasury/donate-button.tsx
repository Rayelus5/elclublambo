"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TipDialog } from "@/components/payments/tip-dialog";

/** Opens the payment dialog in donation mode. `autoOpen` serves the "Donar a la DAO" palette action (/dao?donar=1). */
export function DonateButton({ autoOpen = false, label = "Donar a la DAO" }: { autoOpen?: boolean; label?: string }) {
  const [open, setOpen] = useState(autoOpen);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{label}</Button>
      {open ? <TipDialog mode={{ kind: "donation" }} open onOpenChange={setOpen} /> : null}
    </>
  );
}
