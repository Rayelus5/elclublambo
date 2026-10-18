"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { WithdrawDialog } from "@/components/treasury/withdraw-dialog";

/** Opens the withdrawal request dialog. The caller decides whether the viewer may ask (switch on, shares, no active request). */
export function WithdrawButton({ myShares, sharePriceUsd6 }: { myShares: bigint; sharePriceUsd6: bigint }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Retirar
      </Button>
      {open ? <WithdrawDialog open onOpenChange={setOpen} myShares={myShares} sharePriceUsd6={sharePriceUsd6} /> : null}
    </>
  );
}
