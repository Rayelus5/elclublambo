import { Suspense } from "react";
import type { Metadata } from "next";
import { NotFoundFromRequest } from "@/components/status/not-found-view";

// A-R14: one 404 for the whole app (one root layout, so no global-not-found): URLs without a route, every notFound() and
// the proxy's 404 rewrites. The variant (es / en / foro) comes from the proxy's x-pathname, read inside <Suspense>.
export const metadata: Metadata = {
  title: "404 · ElClub.",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <Suspense fallback={<div className="flex-1" aria-hidden />}>
      <NotFoundFromRequest />
    </Suspense>
  );
}
