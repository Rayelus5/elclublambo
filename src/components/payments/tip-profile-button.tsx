"use client";

import { useState } from "react";
import { Coins } from "lucide-react";
import { TipDialog, type TipRecipient } from "@/components/payments/tip-dialog";
import { Button } from "@/components/ui/button";

/** "Dar propina" on a profile that is not the viewer's own. */
export function TipProfileButton({ recipient }: { recipient: TipRecipient }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" className="self-start" onClick={() => setOpen(true)}>
        <Coins aria-hidden />
        Dar propina
      </Button>
      {open ? <TipDialog target={{ type: "profile" }} recipient={recipient} open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}
